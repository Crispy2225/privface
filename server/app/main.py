"""Open password registration with local face enrollment and supplementary descriptor proofs."""
import hashlib
import hmac
import json
import re
import secrets
import time
from typing import Literal
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from .proof_service import ProofService, SCHEME, FIELD, CIRCUIT
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update, delete
from sqlalchemy.exc import IntegrityError
from .passwords import hash_password, verify_password
from .config import Settings, MODEL, QUANTIZATION, COMMITMENT
from .database import Account, Invitation, Credential, Challenge, Enrollment, LoginSession, RateBucket, RecoveryCode, connect

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
    username: str = Field(pattern=r'^[a-zA-Z0-9_]{3,32}$')
    display_name: str = Field(min_length=1,max_length=80)
    password: str = Field(min_length=12,max_length=128,repr=False)

class Login(Input):
    username: str = Field(pattern=r'^[a-zA-Z0-9_]{3,32}$')

class Finish(Input):
    challenge_id: str = Field(min_length=36, max_length=36)

class PasswordFinish(Finish):
    password: str = Field(min_length=1,max_length=128,repr=False)

class NewPasswordFinish(Finish):
    password: str = Field(min_length=12,max_length=128,repr=False)

class ProofFinish(Input):
    challenge_id: str = Field(min_length=36, max_length=36)
    proof: dict
    publicSignals: list[str] = Field(min_length=6, max_length=6)

class Recovery(Input):
    recovery_code: str = Field(min_length=32, max_length=256)

class SecurityAction(Input):
    action: Literal['recovery-code', 'revoke-binding', 'logout-all', 'disable-account']

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

    app = FastAPI(title='PrivFace API', version='0.4.0', lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request,exc):
        return JSONResponse(status_code=422,content={'detail':'Invalid request. Check required fields, username format, and password length (12–128 characters for a new password).'})

    def password_limit(challenge_id):
        with app.state.db() as db:
            ch=db.get(Challenge,challenge_id)
            identity=ch.account_id if ch else challenge_id
        limit('password:'+identity,12)

    def configure(config):
        app.state.settings = config
        app.state.engine, app.state.db = connect(config.database_url)
        app.state.proofs = ProofService(config) if config.proof_enabled else None

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
            reject('Sign in with your username and password first', 401)
        account = db.get(Account, row.account_id)
        if not account or not account.active or not account.password_hash:
            reject('Account unavailable', 401)
        if csrf and not hmac.compare_digest(row.csrf, request.headers.get('x-csrf-token', '')):
            reject('CSRF check failed', 403)
        return row, account

    def issue_session(db, account, response, request):
        if not account.active: reject()
        old = request.cookies.get(COOKIE)
        if old:
            db.execute(update(LoginSession).where(LoginSession.digest == digest(old)).values(revoked=True))
        token = secrets.token_urlsafe(32)
        row = LoginSession(digest=digest(token), account_id=account.id, csrf=secrets.token_urlsafe(32), expires_at=now() + app.state.settings.session_seconds)
        db.add(row)
        response.set_cookie(COOKIE, token, httponly=True, secure=app.state.settings.secure_cookie, samesite='strict', max_age=app.state.settings.session_seconds, path='/api')
        return {'account': {'id': account.id, 'username': account.username, 'display_name': account.display_name}, 'csrf': row.csrf, 'authentication': 'password'}

    def new_challenge(db, account_id, operation, **kwargs):
        limit('account:' + account_id, 12)
        row = Challenge(account_id=account_id, operation=operation, nonce=secrets.token_bytes(32), expires_at=now() + app.state.settings.challenge_seconds, **kwargs)
        db.add(row)
        db.flush()
        return row

    def lock_account(db, account_id):
        return db.scalar(select(Account).where(Account.id == account_id).with_for_update().execution_options(populate_existing=True))

    def consume(db, challenge_id, operation):
        pending = db.get(Challenge, challenge_id)
        if not pending or pending.operation != operation: reject()
        lock_account(db, pending.account_id)
        # UPDATE ... RETURNING is atomic: concurrent requests cannot both succeed.
        row = db.execute(update(Challenge).where(Challenge.id == challenge_id, Challenge.operation == operation, Challenge.consumed.is_(False), Challenge.expires_at > now()).values(consumed=True).returning(Challenge)).scalar_one_or_none()
        if not row:
            reject()
        return row

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'service': 'isl-verification-server', 'version': app.version}

    @app.post('/api/accounts/register')
    def signup(body: Signup, response: Response, request: Request):
        if not body.display_name.strip(): reject('Enter a display name')
        password_hash=hash_password(body.password)
        try:
            with app.state.db.begin() as db:
                account=db.scalar(select(Account).where(Account.username==body.username.lower()).with_for_update())
                if account:
                    # Only an UNUSED operator reservation can become an open signup.
                    # Active/disabled accounts and existing credentials stay protected.
                    invite=db.scalar(select(Invitation).where(Invitation.account_id==account.id))
                    credential=db.scalar(select(Credential).where(Credential.account_id==account.id))
                    if account.active or account.password_hash or credential or not invite or invite.used:
                        reject('Username already registered. Sign in or recover your account.',409)
                    invite.used=True
                    db.execute(update(Challenge).where(Challenge.account_id==account.id).values(consumed=True))
                else:
                    account=Account(username=body.username.lower())
                    db.add(account)
                account.display_name=body.display_name.strip()
                account.password_hash=password_hash
                account.active=True
                db.flush()
                return issue_session(db,account,response,request)
        except IntegrityError: reject('Username already registered. Choose another username.',409)

    @app.post('/api/login/options')
    def login_options(body: Login):
        with app.state.db.begin() as db:
            account=db.scalar(select(Account).where(Account.username==body.username.lower(),Account.active.is_(True)))
            if not account or not account.password_hash: reject('Username or password is incorrect',401)
            ch=new_challenge(db,account.id,'login')
            return {'challenge_id':ch.id}

    @app.post('/api/login/verify')
    def login_verify(body: PasswordFinish,response: Response,request: Request):
        password_limit(body.challenge_id)
        with app.state.db.begin() as db:
            ch=consume(db,body.challenge_id,'login')
            account=db.get(Account,ch.account_id)
            if not account.active or not verify_password(body.password,account.password_hash): reject('Username or password is incorrect',401)
            return issue_session(db,account,response,request)

    @app.get('/api/session')
    def get_session(request: Request):
        with app.state.db() as db:
            current, account = session(db, request)
            enrollment = db.get(Enrollment, account.id)
            context = current.proof_context
            if context and (not enrollment or not app.state.proofs or context.get('commitment') != enrollment.commitment or context.get('version') != enrollment.version or context.get('setup_id') != app.state.proofs.setup_id or context.get('limit') != app.state.proofs.policy()['limit']): context = None
            return {'account': {'id': account.id, 'username': account.username, 'display_name': account.display_name}, 'csrf': current.csrf, 'authentication': 'password', 'descriptor_proof': context, 'enrollment': {'commitment': enrollment.commitment, 'version': enrollment.version, 'model': enrollment.model, 'quantization': enrollment.quantization, 'scheme': enrollment.scheme} if enrollment else None}

    @app.post('/api/logout')
    def logout(request: Request, response: Response):
        with app.state.db.begin() as db:
            current, _ = session(db, request, csrf=True)
            current.revoked = True
            response.delete_cookie(COOKIE, path='/api')
            return {'ok': True}

    def require_current(db,request):
        current,account=session(db,request,csrf=True)
        account=lock_account(db,account.id)
        db.refresh(current)
        if not account.active or not account.password_hash or current.revoked or current.expires_at<=now():reject('Sign in again',401)
        return current,account

    @app.post('/api/enrollment/options')
    def enrollment_options(body: Binding,request: Request):
        if body.model!=MODEL or body.quantization!=QUANTIZATION or body.scheme not in (COMMITMENT,SCHEME):reject('Unsupported template or commitment version')
        if body.scheme==SCHEME and (not app.state.proofs or not 0<int(body.commitment,16)<FIELD):reject('Proof binding unavailable or invalid')
        with app.state.db.begin() as db:
            current,account=require_current(db,request)
            ch=new_challenge(db,account.id,'enroll',session_digest=current.digest,payload=body.model_dump())
            return {'challenge_id':ch.id}

    @app.post('/api/enrollment/verify')
    def enrollment_verify(body: Finish,request: Request):
        with app.state.db.begin() as db:
            current,account=require_current(db,request)
            ch=consume(db,body.challenge_id,'enroll')
            if ch.account_id!=account.id or ch.session_digest!=current.digest:reject()
            row=db.get(Enrollment,account.id)
            if not row:
                row=Enrollment(account_id=account.id,version=0)
                db.add(row)
            row.credential_id=None
            row.commitment,row.model=ch.payload['commitment'],ch.payload['model']
            row.quantization,row.scheme=ch.payload['quantization'],ch.payload['scheme']
            row.version+=1;row.updated_at=now()
            db.flush()
            db.execute(update(LoginSession).where(LoginSession.account_id==account.id).values(proof_context=None))
            db.execute(update(Challenge).where(Challenge.account_id==account.id,Challenge.operation=='proof').values(consumed=True))
            return {'bound':True,'version':row.version,'commitment':row.commitment}

    @app.post('/api/security/options')
    def security_options(body: SecurityAction,request: Request):
        with app.state.db.begin() as db:
            current,account=require_current(db,request)
            ch=new_challenge(db,account.id,'security',session_digest=current.digest,payload={'action':body.action})
            return {'challenge_id':ch.id}

    @app.post('/api/security/verify')
    def security_verify(body: PasswordFinish,request: Request,response: Response):
        password_limit(body.challenge_id)
        with app.state.db.begin() as db:
            current,account=require_current(db,request)
            ch=consume(db,body.challenge_id,'security')
            if ch.account_id!=account.id or ch.session_digest!=current.digest:reject()
            if not verify_password(body.password,account.password_hash):reject('Password is incorrect',401)
            action=ch.payload['action']
            if action=='recovery-code':
                code=secrets.token_urlsafe(32)
                record=db.get(RecoveryCode,account.id)
                if not record:record=RecoveryCode(account_id=account.id);db.add(record)
                record.digest,record.used,record.created_at=digest(code),False,now()
                return {'recovery_code':code}
            if action=='revoke-binding':
                db.execute(delete(Enrollment).where(Enrollment.account_id==account.id))
                db.execute(update(LoginSession).where(LoginSession.account_id==account.id).values(proof_context=None))
                db.execute(update(Challenge).where(Challenge.account_id==account.id,Challenge.operation.in_(['enroll','proof'])).values(consumed=True))
                return {'revoked':True}
            if action=='disable-account':
                account.active=False
                db.execute(delete(Enrollment).where(Enrollment.account_id==account.id))
                db.execute(delete(RecoveryCode).where(RecoveryCode.account_id==account.id))
            db.execute(update(LoginSession).where(LoginSession.account_id==account.id).values(revoked=True))
            db.execute(update(Challenge).where(Challenge.account_id==account.id).values(consumed=True))
            response.delete_cookie(COOKIE,path='/api')
            return {'revoked':True}

    @app.post('/api/recovery/options')
    def recovery_options(body: Recovery):
        with app.state.db.begin() as db:
            code=db.scalar(select(RecoveryCode).where(RecoveryCode.digest==digest(body.recovery_code),RecoveryCode.used.is_(False)))
            if not code:reject()
            account=lock_account(db,code.account_id)
            if not account.active:reject()
            ch=new_challenge(db,account.id,'recover',payload={'recovery_digest':code.digest})
            return {'challenge_id':ch.id}

    @app.post('/api/recovery/verify')
    def recovery_verify(body: NewPasswordFinish,request: Request,response: Response):
        password_limit(body.challenge_id)
        with app.state.db.begin() as db:
            ch=consume(db,body.challenge_id,'recover')
            account=db.get(Account,ch.account_id)
            if not account.active:reject()
            code=db.execute(update(RecoveryCode).where(RecoveryCode.account_id==account.id,RecoveryCode.digest==ch.payload['recovery_digest'],RecoveryCode.used.is_(False)).values(used=True).returning(RecoveryCode)).scalar_one_or_none()
            if not code:reject()
            account.password_hash=hash_password(body.password)
            db.execute(delete(Enrollment).where(Enrollment.account_id==account.id))
            db.execute(update(Challenge).where(Challenge.account_id==account.id).values(consumed=True))
            db.execute(update(LoginSession).where(LoginSession.account_id==account.id).values(revoked=True))
            return issue_session(db,account,response,request)

    @app.get('/api/proof/config')
    def proof_config():
        return app.state.proofs.config() if app.state.proofs else {'enabled':False}

    @app.get('/api/proof/assets/{name}')
    def proof_asset(name: str):
        service=app.state.proofs
        if not service or name not in service.assets: reject('Artifact unavailable',404)
        return FileResponse(service.directory / service.assets[name]['path'], media_type='application/wasm' if name.endswith('.wasm') else 'application/octet-stream')

    @app.post('/api/proof/options')
    def proof_options(body: Input, request: Request):
        service=app.state.proofs
        if not service: reject('Proof verification is not configured',503)
        with app.state.db.begin() as db:
            current, account=session(db,request,csrf=True)
            account=lock_account(db,account.id)
            db.refresh(current)
            if not account.active or current.revoked or current.expires_at<=now(): reject()
            binding=db.get(Enrollment,account.id)
            if not binding or binding.scheme!=SCHEME: reject('Authorize a proof-compatible local template binding first',409)
            policy=service.policy()
            ch=new_challenge(db,account.id,'proof',credential_id=binding.credential_id,session_digest=current.digest,payload={
                'commitment':binding.commitment,'version':binding.version,'limit':policy['limit'],'setup_id':service.setup_id})
            expected={'account':str(int(account.id.replace('-',''),16)),'nonce':str(int.from_bytes(ch.nonce[:31],'big')),'enrollmentRoot':str(int(binding.commitment,16)),'limit':policy['limit'],'modelTag':'1'}
            return {'challenge_id':ch.id,'expires_at':ch.expires_at,'inputs':expected,'commitment':binding.commitment,'version':binding.version,'config':service.config()}

    @app.post('/api/proof/verify')
    def proof_verify(body: ProofFinish, request: Request):
        service=app.state.proofs
        if not service: reject('Proof verification is not configured',503)
        # First authenticate and snapshot the public context. Expensive verification
        # occurs outside the transaction. Recheck everything under the account lock.
        with app.state.db() as db:
            current,account=session(db,request,csrf=True)
            ch=db.get(Challenge,body.challenge_id)
            if not ch or ch.operation!='proof' or ch.consumed or ch.expires_at<=now() or ch.account_id!=account.id or ch.session_digest!=current.digest: reject()
            expected={'account':str(int(account.id.replace('-',''),16)),'nonce':str(int.from_bytes(ch.nonce[:31],'big')),'enrollmentRoot':str(int(ch.payload['commitment'],16)),'limit':ch.payload['limit'],'modelTag':'1'}
        try: valid=service.verify(body.proof,body.publicSignals,expected)
        except RuntimeError: reject('Verifier busy; retry shortly',503)
        if not valid: reject('Invalid descriptor proof')
        with app.state.db.begin() as db:
            current,account=session(db,request,csrf=True)
            ch=consume(db,body.challenge_id,'proof')
            db.refresh(current); db.refresh(account)
            binding=db.get(Enrollment,account.id)
            if not account.active or current.revoked or current.expires_at<=now() or ch.session_digest!=current.digest or ch.account_id!=account.id: reject()
            if not binding or binding.scheme!=SCHEME or binding.commitment!=ch.payload['commitment'] or binding.version!=ch.payload['version'] or service.setup_id!=ch.payload['setup_id'] or service.policy()['limit']!=ch.payload['limit']: reject('Binding or policy changed; start again')
            current.proof_context={**ch.payload,'verified_at':now(),'circuit':CIRCUIT}
            return {'verified':True,'scope':'private-descriptor-comparison','authentication':'password','verified_at':now()}

    return app

app = create_app()
