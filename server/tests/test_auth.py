"""Password authentication, account ownership, CSRF, and single-use challenges."""
import os
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select,update

from app.config import Settings,MODEL,QUANTIZATION,COMMITMENT
from app.database import Base,Account,Challenge,Credential,Enrollment,Invitation,LoginSession
from app.main import create_app,now,digest
from app.passwords import verify_password
ORIGIN='http://localhost:5173'
HEADERS={'origin':ORIGIN,'x-privface-request':'1'}
PASSWORD='Correct horse battery 42!'
NEW_PASSWORD='Another unique passphrase 73!'
@pytest.fixture
def app(tmp_path):
    app=create_app(Settings(os.getenv('TEST_DATABASE_URL','sqlite:///'+str(tmp_path/'auth.sqlite'))))
    Base.metadata.create_all(app.state.engine)
    yield app
    Base.metadata.drop_all(app.state.engine);app.state.engine.dispose()
@pytest.fixture
def client(app):
    with TestClient(app,headers=HEADERS) as client:yield client

def register(app,client,username='alice'):
    result=client.post('/api/accounts/register',json={'username':username,'display_name':username.title(),'password':PASSWORD})
    assert result.status_code==200,result.text
    return result.json()
def binding():return {'commitment':'ab'*32,'model':MODEL,'quantization':QUANTIZATION,'scheme':COMMITMENT}
def options(client,path,body,session=None):
    response=client.post('/api/'+path+'/options',json=body,headers={'x-csrf-token':session['csrf']} if session else {})
    assert response.status_code==200,response.text
    return response.json()
def security(client,session,action,password=PASSWORD):
    challenge=options(client,'security',{'action':action},session)
    return client.post('/api/security/verify',json={**challenge,'password':password},headers={'x-csrf-token':session['csrf']})

def test_open_registration_hashes_password_and_uses_http_only_cookie(app,client):
    session=register(app,client,'ALICE')
    assert session['account']['username']=='alice'
    assert session['authentication']=='password'
    assert client.get('/api/session').json()['authentication']=='password'
    with app.state.db() as db:
        account=db.scalar(select(Account));assert account.password_hash!=PASSWORD
        assert verify_password(PASSWORD,account.password_hash)
        assert db.scalar(select(Credential)) is None
        assert db.scalar(select(Invitation)) is None
    duplicate=client.post('/api/accounts/register',json={'username':'alice','display_name':'Intruder','password':NEW_PASSWORD})
    assert duplicate.status_code==409

@pytest.mark.parametrize('change',[{'password':'short'},{'password':'x'*129},{'username':'bad name'},{'display_name':'   '},{'invitation':'not-needed'}])
def test_invalid_signup(app,client,change):
    body={'username':'alice','display_name':'Alice','password':PASSWORD,**change}
    response=client.post('/api/accounts/register',json=body)
    assert response.status_code in (400,422)
    assert PASSWORD not in response.text

def test_unused_reservation_can_register_without_invitation(app,client):
    with app.state.db.begin() as db:
        reserved=Account(username='atharv',display_name='Atharv');db.add(reserved);db.flush()
        db.add(Invitation(account_id=reserved.id,digest='a'*64,expires_at=now()+3600))
    with app.state.db() as db:identity=db.scalar(select(Account)).id
    session=register(app,client,'atharv')
    assert session['account']['id']==identity
    with app.state.db() as db:assert db.scalar(select(Invitation)).used

def test_existing_legacy_account_cannot_be_claimed(app,client):
    with app.state.db.begin() as db:db.add(Account(username='alice',display_name='Alice',active=True))
    assert client.post('/api/accounts/register',json={'username':'alice','display_name':'Alice','password':PASSWORD}).status_code==409
    assert client.post('/api/login/options',json={'username':'alice'}).status_code==401

def test_login_password_replay_and_logout(app,client):
    session=register(app,client)
    ch=options(client,'login',{'username':'ALICE'})
    assert client.post('/api/login/verify',json={**ch,'password':'incorrect'}).status_code==401
    result=client.post('/api/login/verify',json={**ch,'password':PASSWORD})
    assert result.status_code==200,result.text
    cookie=result.headers['set-cookie'].lower();assert 'httponly' in cookie and 'samesite=strict' in cookie
    assert client.post('/api/login/verify',json={**ch,'password':PASSWORD}).status_code==400
    assert client.post('/api/logout',json={},headers={'x-csrf-token':session['csrf']}).status_code==403
    assert client.post('/api/logout',json={},headers={'x-csrf-token':result.json()['csrf']}).status_code==200
    assert client.get('/api/session').status_code==401

def test_expired_challenges_and_sessions(app,client):
    register(app,client);ch=options(client,'login',{'username':'alice'})
    with app.state.db.begin() as db:db.execute(update(Challenge).values(expires_at=now()-1))
    assert client.post('/api/login/verify',json={**ch,'password':PASSWORD}).status_code==400
    with app.state.db.begin() as db:db.execute(update(LoginSession).values(expires_at=now()-1))
    assert client.get('/api/session').status_code==401

def test_binding_requires_session_csrf_and_consumes_exact_pending_payload(app,client):
    assert client.post('/api/enrollment/options',json=binding()).status_code==401
    session=register(app,client);headers={'x-csrf-token':session['csrf']}
    assert client.post('/api/enrollment/options',json=binding()).status_code==403
    ch=options(client,'enrollment',binding(),session)
    assert client.post('/api/enrollment/verify',json={**ch,'commitment':'cd'*32},headers=headers).status_code==422
    result=client.post('/api/enrollment/verify',json=ch,headers=headers)
    assert result.status_code==200,result.text
    assert result.json()['commitment']==binding()['commitment']
    assert client.post('/api/enrollment/verify',json=ch,headers=headers).status_code==400
    with app.state.db() as db:assert db.scalar(select(Enrollment)).credential_id is None

def test_binding_rejects_other_account_session_and_operation(app,client):
    alice=register(app,client);ch=options(client,'enrollment',binding(),alice)
    assert client.post('/api/login/verify',json={**ch,'password':PASSWORD}).status_code==400
    bob=register(app,client,'bobby')
    assert client.post('/api/enrollment/verify',json=ch,headers={'x-csrf-token':bob['csrf']}).status_code==400
    login=options(client,'login',{'username':'alice'})
    fresh=client.post('/api/login/verify',json={**login,'password':PASSWORD}).json()
    assert client.post('/api/enrollment/verify',json=ch,headers={'x-csrf-token':fresh['csrf']}).status_code==400

@pytest.mark.parametrize('action',['revoke-binding','logout-all','disable-account'])
def test_security_requires_password_and_revokes_pending_challenges(app,client,action):
    session=register(app,client);headers={'x-csrf-token':session['csrf']}
    pending=options(client,'enrollment',binding(),session)
    assert security(client,session,action,'wrong').status_code==401
    assert security(client,session,action).status_code==200
    assert client.post('/api/enrollment/verify',json=pending,headers=headers).status_code in (400,401)
    if action!='revoke-binding':assert client.get('/api/session').status_code==401
    if action=='disable-account':
        assert client.post('/api/login/options',json={'username':'alice'}).status_code==401
        assert client.post('/api/accounts/register',json={'username':'alice','display_name':'Alice','password':PASSWORD}).status_code==409

def test_recovery_resets_password_revokes_sessions_and_binding_once(app,client):
    session=register(app,client);old_cookie=client.cookies.get('privface_session')
    bind=options(client,'enrollment',binding(),session)
    assert client.post('/api/enrollment/verify',json=bind,headers={'x-csrf-token':session['csrf']}).status_code==200
    code=security(client,session,'recovery-code').json()['recovery_code']
    ch=options(client,'recovery',{'recovery_code':code})
    result=client.post('/api/recovery/verify',json={**ch,'password':NEW_PASSWORD})
    assert result.status_code==200,result.text
    assert client.post('/api/recovery/verify',json={**ch,'password':NEW_PASSWORD}).status_code==400
    assert client.post('/api/recovery/options',json={'recovery_code':code}).status_code==400
    assert client.get('/api/session').json()['enrollment'] is None
    with app.state.db() as db:assert db.get(LoginSession,digest(old_cookie)).revoked
    ch=options(client,'login',{'username':'alice'})
    assert client.post('/api/login/verify',json={**ch,'password':PASSWORD}).status_code==401
    assert client.post('/api/login/verify',json={**ch,'password':NEW_PASSWORD}).status_code==200

def test_concurrent_login_challenge_consumed_once(app,client):
    register(app,client);ch=options(client,'login',{'username':'alice'})
    def send(_):
        with TestClient(app,headers=HEADERS) as c:return c.post('/api/login/verify',json={**ch,'password':PASSWORD}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(send,range(2)))==[200,400]

def test_origin_body_limits_and_legacy_routes_removed(app,client):
    assert client.post('/api/login/options',json={'username':'alice'},headers={'origin':'https://evil.example'}).status_code==403
    assert client.post('/api/login/options',content=b'x'*32769).status_code==413
    assert client.post('/api/accounts/options',json={'invitation':'x'*40}).status_code==404
    responses=[client.post('/api/login/options',json={'username':'unknown'}) for _ in range(61)]
    assert responses[-1].status_code==429

def test_password_attempts_limited_per_account(app,client):
    register(app,client);ch=options(client,'login',{'username':'alice'})
    responses=[client.post('/api/login/verify',json={**ch,'password':'wrong'}) for _ in range(13)]
    assert responses[-1].status_code==429

def test_local_operator_can_provide_recovery_for_existing_legacy_account(app,client,tmp_path):
    from app.admin import issue_recovery
    with app.state.db.begin() as db:db.add(Account(username='legacy',display_name='Legacy',active=True))
    path=issue_recovery(app.state.db,'legacy',tmp_path)
    assert path.stat().st_mode & 0o777==0o600
    code=path.read_text().strip()
    ch=options(client,'recovery',{'recovery_code':code})
    assert client.post('/api/recovery/verify',json={**ch,'password':NEW_PASSWORD}).status_code==200
    with app.state.db() as db:assert verify_password(NEW_PASSWORD,db.scalar(select(Account)).password_hash)
