"""Passkey-authenticated accounts. Face checks remain local; no ZK verifier exists."""
import hashlib
import hmac
import json
import re
import secrets
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from webauthn import generate_authentication_options, generate_registration_options, options_to_json, verify_authentication_response, verify_registration_response
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
from webauthn.helpers.structs import AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor, ResidentKeyRequirement, UserVerificationRequirement
from .config import Settings, MODEL, QUANTIZATION, COMMITMENT
from .database import Account, Invitation, Credential, Challenge, Enrollment, LoginSession, RateBucket, connect

COOKIE = 'privface_session'

def now():
    return int(time.time())

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def reject(message='Invalid, expired, or already used authorization', status=400):
    raise HTTPException(status, message)

class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Signup(Input):
    invitation: str = Field(min_length=32, max_length=256)

class Login(Input):
    username: str = Field(pattern=r'^[a-zA-Z0-9_]{3,32}$')

class Finish(Input):
    challenge_id: str = Field(min_length=36, max_length=36)
    credential: dict

class Binding(Input):
    commitment: str = Field(pattern=r'^[0-9a-f]{64}$')
    model: str
    quantization: str
    scheme: str


def create_app(settings: Settings | None = None):
    @asynccontextmanager
    async def lifespan(app):
        if not hasattr(app.state, 'db'):
            configure(settings or Settings.from_env())
        yield
        app.state.engine.dispose()

    app = FastAPI(title='PrivFace API', version='0.2.0', lifespan=lifespan)

    def configure(config):
        app.state.settings = config
        app.state.engine, app.state.db = connect(config.database_url)

    if settings:
        configure(settings)

    def limit(key, maximum):
        """Shared, atomic fixed-window limiter, including across server workers."""
        factory = app.state.db
        bucket_key, window = digest(key), now() // 60
        # An upsert avoids first-request races. Both supported dialects implement it.
        if app.state.engine.dialect.name == 'postgresql':
            from sqlalchemy.dialects.postgresql import insert
        else:
            from sqlalchemy.dialects.sqlite import insert
        from sqlalchemy import case
        with factory.begin() as db:
            stmt = insert(RateBucket).values(key=bucket_key, window=window, count=1)
            stmt = stmt.on_conflict_do_update(index_elements=['key'], set_={
                'window': window, 'count': case((RateBucket.window == window, RateBucket.count + 1), else_=1),
            }).returning(RateBucket.count)
            count = db.execute(stmt).scalar_one()
        if count > maximum:
            reject('Too many requests. Try again in a minute.', 429)

    @app.middleware('http')
    async def guard(request: Request, call_next):
        if request.method == 'POST':
            config = app.state.settings
            if request.headers.get('origin') != config.origin or request.headers.get('x-privface-request') != '1':
                return Response('Origin check failed', status_code=403)
            # Bound JSON bodies even for chunked requests before Pydantic parses them.
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 32768:
                    return Response('Request too large', status_code=413)
            request._body = bytes(body)
            try:
                limit('ip:' + (request.client.host if request.client else 'unknown'), 60)
            except HTTPException as exc:
                return Response(exc.detail, status_code=exc.status_code)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    def session(db, request, csrf=False):
        token = request.cookies.get(COOKIE, '')
        row = db.get(LoginSession, digest(token)) if token else None
        if not row or row.revoked or row.expires_at <= now():
            reject('Sign in with your passkey first', 401)
        account = db.get(Account, row.account_id)
        if not account or not account.active:
            reject('Account unavailable', 401)
        if csrf and not hmac.compare_digest(row.csrf, request.headers.get('x-csrf-token', '')):
            reject('CSRF check failed', 403)
        return row, account

    def issue_session(db, account, response, request):
        old = request.cookies.get(COOKIE)
        if old:
            db.execute(update(LoginSession).where(LoginSession.digest == digest(old)).values(revoked=True))
        token = secrets.token_urlsafe(32)
        row = LoginSession(digest=digest(token), account_id=account.id, csrf=secrets.token_urlsafe(32), expires_at=now() + app.state.settings.session_seconds)
        db.add(row)
        response.set_cookie(COOKIE, token, httponly=True, secure=app.state.settings.secure_cookie, samesite='strict', max_age=app.state.settings.session_seconds, path='/api')
        return {'account': {'id': account.id, 'username': account.username, 'display_name': account.display_name}, 'csrf': row.csrf, 'authentication': 'passkey'}

    def new_challenge(db, account_id, operation, **kwargs):
        limit('account:' + account_id, 12)
        row = Challenge(account_id=account_id, operation=operation, nonce=secrets.token_bytes(32), expires_at=now() + app.state.settings.challenge_seconds, **kwargs)
        db.add(row)
        db.flush()
        return row

    def consume(db, challenge_id, operation):
        # UPDATE ... RETURNING is atomic: concurrent requests cannot both succeed.
        row = db.execute(update(Challenge).where(Challenge.id == challenge_id, Challenge.operation == operation, Challenge.consumed.is_(False), Challenge.expires_at > now()).values(consumed=True).returning(Challenge)).scalar_one_or_none()
        if not row:
            reject()
        return row

    def auth_options(db, challenge):
        config = app.state.settings
        return {'challenge_id': challenge.id, 'publicKey': json.loads(options_to_json(generate_authentication_options(
            rp_id=config.rp_id, challenge=challenge.nonce, timeout=config.challenge_seconds * 1000,
            allow_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(challenge.credential_id))], user_verification=UserVerificationRequirement.REQUIRED,
        )))}

    def assertion(db, challenge, credential):
        stored = db.scalar(select(Credential).where(Credential.id == challenge.credential_id).with_for_update())
        if not stored or stored.account_id != challenge.account_id:
            reject()
        if credential.get('id') != stored.id:
            reject()
        try:
            user_handle = credential.get('response', {}).get('userHandle')
            if user_handle and base64url_to_bytes(user_handle) != challenge.account_id.encode():
                reject()
            verified = verify_authentication_response(credential=credential, expected_challenge=challenge.nonce, expected_rp_id=app.state.settings.rp_id, expected_origin=app.state.settings.origin, credential_public_key=stored.public_key, credential_current_sign_count=stored.sign_count, require_user_verification=True)
        except Exception:
            reject('Passkey verification failed')
        stored.sign_count = verified.new_sign_count
        return stored

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'service': 'isl-verification-server', 'version': app.version}

    @app.post('/api/accounts/options')
    def signup_options(body: Signup):
        with app.state.db.begin() as db:
            invite = db.get(Invitation, digest(body.invitation))
            if not invite or invite.used or invite.expires_at <= now(): reject()
            account = db.get(Account, invite.account_id)
            if account.active: reject()
            ch = new_challenge(db, account.id, 'register', payload={'invitation': invite.digest})
            options = generate_registration_options(rp_id=app.state.settings.rp_id, rp_name='PrivFace', user_id=account.id.encode(), user_name=account.username, user_display_name=account.display_name, challenge=ch.nonce, timeout=app.state.settings.challenge_seconds * 1000, authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.PREFERRED, user_verification=UserVerificationRequirement.REQUIRED))
            return {'challenge_id': ch.id, 'username': account.username, 'publicKey': json.loads(options_to_json(options))}

    @app.post('/api/accounts/verify')
    def signup_verify(body: Finish, response: Response, request: Request):
        try:
            with app.state.db.begin() as db:
                ch = consume(db, body.challenge_id, 'register')
                invite = db.execute(update(Invitation).where(Invitation.digest == ch.payload['invitation'], Invitation.used.is_(False), Invitation.expires_at > now()).values(used=True).returning(Invitation)).scalar_one_or_none()
                if not invite or invite.account_id != ch.account_id: reject()
                account = db.get(Account, ch.account_id)
                if account.active: reject()
                try:
                    result = verify_registration_response(credential=body.credential, expected_challenge=ch.nonce, expected_rp_id=app.state.settings.rp_id, expected_origin=app.state.settings.origin, require_user_verification=True)
                except Exception:
                    reject('Passkey registration failed')
                db.add(Credential(id=bytes_to_base64url(result.credential_id), account_id=account.id, public_key=result.credential_public_key, sign_count=result.sign_count))
                account.active = True
                return issue_session(db, account, response, request)
        except IntegrityError:
            reject('Account or credential is already registered', 409)

    @app.post('/api/login/options')
    def login_options(body: Login):
        with app.state.db.begin() as db:
            account = db.scalar(select(Account).where(Account.username == body.username.lower(), Account.active.is_(True)))
            credential = db.scalar(select(Credential).where(Credential.account_id == account.id)) if account else None
            if not credential: reject('No available passkey for this account', 404)
            return auth_options(db, new_challenge(db, account.id, 'login', credential_id=credential.id))

    @app.post('/api/login/verify')
    def login_verify(body: Finish, response: Response, request: Request):
        with app.state.db.begin() as db:
            ch = consume(db, body.challenge_id, 'login')
            account = db.get(Account, ch.account_id)
            if not account.active: reject()
            assertion(db, ch, body.credential)
            return issue_session(db, account, response, request)

    @app.get('/api/session')
    def get_session(request: Request):
        with app.state.db() as db:
            current, account = session(db, request)
            enrollment = db.get(Enrollment, account.id)
            return {'account': {'id': account.id, 'username': account.username, 'display_name': account.display_name}, 'csrf': current.csrf, 'authentication': 'passkey', 'enrollment': {'commitment': enrollment.commitment, 'version': enrollment.version, 'model': enrollment.model, 'quantization': enrollment.quantization, 'scheme': enrollment.scheme} if enrollment else None}

    @app.post('/api/logout')
    def logout(request: Request, response: Response):
        with app.state.db.begin() as db:
            current, _ = session(db, request, csrf=True)
            current.revoked = True
            response.delete_cookie(COOKIE, path='/api')
            return {'ok': True}

    @app.post('/api/enrollment/options')
    def enrollment_options(body: Binding, request: Request):
        if (body.model, body.quantization, body.scheme) != (MODEL, QUANTIZATION, COMMITMENT):
            reject('Unsupported template or commitment version')
        with app.state.db.begin() as db:
            current, account = session(db, request, csrf=True)
            credential = db.scalar(select(Credential).where(Credential.account_id == account.id))
            ch = new_challenge(db, account.id, 'enroll', credential_id=credential.id, session_digest=current.digest, payload=body.model_dump())
            return auth_options(db, ch)

    @app.post('/api/enrollment/verify')
    def enrollment_verify(body: Finish, request: Request):
        with app.state.db.begin() as db:
            current, account = session(db, request, csrf=True)
            ch = consume(db, body.challenge_id, 'enroll')
            if ch.account_id != account.id or ch.session_digest != current.digest: reject()
            credential = assertion(db, ch, body.credential)
            # Serialize enrollment updates on the account even for an initial insert.
            db.execute(select(Account).where(Account.id == account.id).with_for_update()).scalar_one()
            row = db.get(Enrollment, account.id)
            if not row:
                row = Enrollment(account_id=account.id, version=0)
                db.add(row)
            row.credential_id = credential.id
            row.commitment, row.model = ch.payload['commitment'], ch.payload['model']
            row.quantization, row.scheme = ch.payload['quantization'], ch.payload['scheme']
            row.version += 1
            row.updated_at = now()
            return {'bound': True, 'version': row.version, 'commitment': row.commitment}

    return app

app = create_app()
