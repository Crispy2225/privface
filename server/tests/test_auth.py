"""Exercise real WebAuthn cryptographic verification with a software authenticator."""
import hashlib
import json
import os
import secrets
from concurrent.futures import ThreadPoolExecutor
import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from app.admin import issue_invitation
from app.config import Settings, MODEL, QUANTIZATION, COMMITMENT
from app.database import Base, Account, Challenge, Credential, Enrollment, Invitation, LoginSession
from app.main import create_app, digest, now
from webauthn.helpers import bytes_to_base64url as enc, base64url_to_bytes as dec

ORIGIN = 'http://localhost:5173'
HEADERS = {'origin': ORIGIN, 'x-privface-request': '1'}

class Authenticator:
    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.id = secrets.token_bytes(32)
        self.count = 0

    def response(self, options, register=False, origin=ORIGIN, uv=True, rp='localhost'):
        client = json.dumps({'type': 'webauthn.create' if register else 'webauthn.get', 'challenge': options['publicKey']['challenge'], 'origin': origin, 'crossOrigin': False}).encode()
        flags = 1 | (4 if uv else 0) | (64 if register else 0)
        self.count += 1
        auth = hashlib.sha256(rp.encode()).digest() + bytes([flags]) + self.count.to_bytes(4, 'big')
        base = {'id': enc(self.id), 'rawId': enc(self.id), 'type': 'public-key', 'clientExtensionResults': {}}
        if register:
            pub = self.key.public_key().public_numbers()
            cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: pub.x.to_bytes(32,'big'), -3: pub.y.to_bytes(32,'big')})
            auth += bytes(16) + len(self.id).to_bytes(2,'big') + self.id + cose
            base['response'] = {'clientDataJSON': enc(client), 'attestationObject': enc(cbor2.dumps({'fmt':'none','attStmt':{},'authData':auth})), 'transports': ['internal']}
        else:
            base['response'] = {'clientDataJSON': enc(client), 'authenticatorData': enc(auth), 'signature': enc(self.key.sign(auth + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))), 'userHandle': None}
        return {'challenge_id': options['challenge_id'], 'credential': base}

@pytest.fixture
def app(tmp_path):
    # TEST_DATABASE_URL must point at a disposable, already-created PostgreSQL database.
    url = os.getenv('TEST_DATABASE_URL', 'sqlite:///' + str(tmp_path / 'auth.sqlite'))
    app = create_app(Settings(url))
    Base.metadata.create_all(app.state.engine)
    yield app
    Base.metadata.drop_all(app.state.engine)
    app.state.engine.dispose()

@pytest.fixture
def client(app):
    with TestClient(app, headers=HEADERS) as client:
        yield client

def register(app, client, username='alice'):
    invite = issue_invitation(app.state.db, username, username.title())
    options = client.post('/api/accounts/options', json={'invitation':invite})
    assert options.status_code == 200, options.text
    auth = Authenticator()
    payload = auth.response(options.json(), register=True)
    response = client.post('/api/accounts/verify', json=payload)
    assert response.status_code == 200, response.text
    return auth, response.json(), payload, invite

def binding():
    return {'commitment': 'ab'*32, 'model':MODEL, 'quantization':QUANTIZATION, 'scheme':COMMITMENT}

def test_registration_session_cookie_and_single_use_invitation(app, client):
    _, session, payload, invite = register(app, client)
    assert session['authentication'] == 'passkey'
    assert client.get('/api/session').json()['account']['username'] == 'alice'
    assert client.post('/api/accounts/verify',json=payload).status_code == 400
    assert client.post('/api/accounts/options',json={'invitation':invite}).status_code == 400
    with app.state.db() as db:
        assert db.scalar(select(Invitation)).used
        stored = db.scalar(select(LoginSession))
        assert stored.digest != client.cookies.get('privface_session')

def test_login_real_signature_replay_and_logout(app, client):
    auth, _, _, _ = register(app, client)
    options = client.post('/api/login/options',json={'username':'ALICE'}).json()
    payload = auth.response(options)
    response = client.post('/api/login/verify',json=payload)
    assert response.status_code == 200, response.text
    cookie = response.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=strict' in cookie
    assert client.post('/api/login/verify',json=payload).status_code == 400
    csrf = response.json()['csrf']
    assert client.post('/api/logout',json={},headers={'x-csrf-token':'wrong'}).status_code == 403
    assert client.post('/api/logout',json={},headers={'x-csrf-token':csrf}).status_code == 200
    assert client.get('/api/session').status_code == 401

@pytest.mark.parametrize('change', ['origin','uv','rp','signature','credential','nonce','userhandle'])
def test_invalid_assertions_fail_closed(app,client,change):
    auth, _, _, _ = register(app,client)
    options = client.post('/api/login/options',json={'username':'alice'}).json()
    kwargs = {'origin':'https://evil.example'} if change=='origin' else {'uv':False} if change=='uv' else {'rp':'evil.example'} if change=='rp' else {}
    payload = auth.response(options,**kwargs)
    if change=='signature': payload['credential']['response']['signature'] = enc(b'bad signature')
    if change=='credential': payload['credential']['id'] = enc(secrets.token_bytes(32))
    if change=='nonce':
        payload['credential']['response']['clientDataJSON'] = enc(json.dumps({'type':'webauthn.get','challenge':enc(secrets.token_bytes(32)),'origin':ORIGIN}).encode())
    if change=='userhandle': payload['credential']['response']['userHandle'] = enc(b'wrong-account')
    assert client.post('/api/login/verify',json=payload).status_code == 400

@pytest.mark.parametrize('change', ['origin','uv','rp'])
def test_registration_rejects_invalid_ceremony(app,client,change):
    invite = issue_invitation(app.state.db,'alice','Alice')
    options = client.post('/api/accounts/options',json={'invitation':invite}).json()
    kwargs = {'origin':'https://evil.example'} if change=='origin' else {'uv':False} if change=='uv' else {'rp':'evil.example'}
    payload = Authenticator().response(options,register=True,**kwargs)
    assert client.post('/api/accounts/verify',json=payload).status_code == 400
    with app.state.db() as db:
        assert not db.scalar(select(Account)).active
        assert db.scalar(select(Credential)) is None


def test_enrollment_binds_exact_server_pending_payload_and_rejects_other_operation(app,client):
    auth, session, _, _ = register(app,client)
    headers = {'x-csrf-token':session['csrf']}
    options = client.post('/api/enrollment/options',json=binding(),headers=headers)
    assert options.status_code == 200, options.text
    payload = auth.response(options.json())
    assert client.post('/api/login/verify',json=payload).status_code == 400
    assert client.post('/api/enrollment/verify',json={**payload,'commitment':'cd'*32},headers=headers).status_code == 422
    response = client.post('/api/enrollment/verify',json=payload,headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()['commitment'] == binding()['commitment']
    assert client.post('/api/enrollment/verify',json=payload,headers=headers).status_code == 400
    with app.state.db() as db:
        row = db.scalar(select(Enrollment))
        assert row.account_id == session['account']['id'] and row.version == 1
    options2 = client.post('/api/enrollment/options',json={**binding(),'commitment':'cd'*32},headers=headers).json()
    assert client.post('/api/enrollment/verify',json=auth.response(options2),headers=headers).json()['version'] == 2


def test_enrollment_requires_session_csrf_and_supported_versions(app,client):
    assert client.post('/api/enrollment/options',json=binding()).status_code == 401
    _, session, _, _ = register(app,client)
    assert client.post('/api/enrollment/options',json=binding()).status_code == 403
    assert client.post('/api/enrollment/options',json={**binding(),'model':'unknown'},headers={'x-csrf-token':session['csrf']}).status_code == 400


def test_challenge_expiry_and_session_expiry(app,client):
    auth, session, _, _ = register(app,client)
    options = client.post('/api/login/options',json={'username':'alice'}).json()
    with app.state.db.begin() as db:
        db.execute(update(Challenge).where(Challenge.id==options['challenge_id']).values(expires_at=now()-1))
    assert client.post('/api/login/verify',json=auth.response(options)).status_code == 400
    with app.state.db.begin() as db: db.execute(update(LoginSession).values(expires_at=now()-1))
    assert client.get('/api/session').status_code == 401


def test_enrollment_rejects_other_account_or_session(app,client):
    auth, alice, _, _ = register(app,client)
    headers = {'x-csrf-token':alice['csrf']}
    options = client.post('/api/enrollment/options',json=binding(),headers=headers).json()
    payload = auth.response(options)
    _, bob, _, _ = register(app,client,'bobby')
    assert client.post('/api/enrollment/verify',json=payload,headers={'x-csrf-token':bob['csrf']}).status_code == 400
    login = client.post('/api/login/options',json={'username':'alice'}).json()
    new_session = client.post('/api/login/verify',json=auth.response(login)).json()
    assert client.post('/api/enrollment/verify',json=payload,headers={'x-csrf-token':new_session['csrf']}).status_code == 400


def test_origin_and_request_limits(app,client):
    assert client.post('/api/login/options',json={'username':'alice'},headers={'origin':'https://evil.example'}).status_code == 403
    assert client.post('/api/login/options',content=b'x'*32769).status_code == 413
    responses=[client.post('/api/login/options',json={'username':'unknown'}) for _ in range(61)]
    assert responses[-1].status_code == 429


def test_concurrent_replay_only_one_session_issued(app,client):
    auth, _, _, _ = register(app,client)
    options = client.post('/api/login/options',json={'username':'alice'}).json()
    payload=auth.response(options)
    # Independent clients avoid shared cookie mutation in the test itself.
    def send(_):
        c=TestClient(app,headers=HEADERS)
        return c.post('/api/login/verify',json=payload).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes=list(pool.map(send,range(2)))
    assert sorted(codes)==[200,400]
    with app.state.db() as db:
        assert len(db.scalars(select(LoginSession)).all())==2

@pytest.mark.parametrize('response', [None, {'userHandle':'!'}, {'userHandle':42}])
def test_malformed_assertion_returns_client_error(app,client,response):
    auth, _, _, _ = register(app,client)
    options=client.post('/api/login/options',json={'username':'alice'}).json()
    payload=auth.response(options)
    payload['credential']['response']=response
    assert client.post('/api/login/verify',json=payload).status_code==400


def test_expired_invitation_and_account_rate_limit(app,client):
    token=issue_invitation(app.state.db,'expired','Expired')
    with app.state.db.begin() as db: db.execute(update(Invitation).values(expires_at=now()-1))
    assert client.post('/api/accounts/options',json={'invitation':token}).status_code==400
    register(app,client)
    responses=[client.post('/api/login/options',json={'username':'alice'}) for _ in range(13)]
    assert responses[-1].status_code==429
