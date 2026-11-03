import json,subprocess,os
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.main import create_app,now
from app.config import Settings
from app.database import Base,Challenge,Enrollment,Account
ROOT=Path(__file__).resolve().parents[2]
H={'origin':'http://localhost:5173','x-privface-request':'1'}
PASSWORD='Correct horse battery 42!'
def prove(payload):
 return json.loads(subprocess.run([os.getenv('NODE_BINARY','node'),str(ROOT/'zk/scripts/m4-test-proof.mjs')],input=json.dumps(payload),text=True,capture_output=True,check=True,timeout=30).stdout)
@pytest.fixture
def env(tmp_path):
 app=create_app(Settings(os.getenv('TEST_DATABASE_URL','sqlite:///'+str(tmp_path/'face.sqlite'))));Base.metadata.create_all(app.state.engine)
 with TestClient(app,headers=H) as c:
  s=c.post('/api/accounts/register',json={'username':'alice','display_name':'Alice','password':PASSWORD}).json();yield app,c,s
 Base.metadata.drop_all(app.state.engine);app.state.engine.dispose()
def enroll(env):
 app,c,s=env;root=prove({'account':str(int(s['account']['id'].replace('-',''),16))})['enrollmentRoot']
 o=c.post('/api/face/enroll/options',json={'password':PASSWORD,'enrollmentRoot':root},headers={'x-csrf-token':s['csrf']});assert o.status_code==200,o.text;o=o.json();body={'challenge_id':o['challenge_id'],**prove(o)}
 r=c.post('/api/face/enroll/verify',json=body,headers={'x-csrf-token':s['csrf']});assert r.status_code==200,r.text
 return body
def test_real_login_replay_and_tampering(env):
 app,c,s=env;body=enroll(env)
 assert c.post('/api/face/enroll/verify',json=body,headers={'x-csrf-token':s['csrf']}).status_code==400
 c.post('/api/logout',json={},headers={'x-csrf-token':s['csrf']})
 o=c.post('/api/face/login/options',json={'username':'alice'}).json();body={'challenge_id':o['challenge_id'],**prove(o)}
 wrong={**body,'publicSignals':[str(int(body['publicSignals'][0])+1),*body['publicSignals'][1:]]}
 assert c.post('/api/face/login/verify',json=wrong).status_code==400
 assert c.get('/api/session').status_code==401
 r=c.post('/api/face/login/verify',json=body);assert r.status_code==200,r.text
 assert c.get('/api/session').json()['authentication']=='face-proof-demo'
 assert c.post('/api/face/login/verify',json=body).status_code==400
@pytest.mark.parametrize('change',['expired','binding','disabled'])
def test_stale_context(env,change):
 app,c,s=env;enroll(env);o=c.post('/api/face/login/options',json={'username':'alice'}).json();body={'challenge_id':o['challenge_id'],**prove(o)}
 c.post('/api/logout',json={},headers={'x-csrf-token':s['csrf']})
 with app.state.db.begin() as db:
  if change=='expired':db.get(Challenge,o['challenge_id']).expires_at=now()-1
  elif change=='binding':db.get(Enrollment,s['account']['id']).version+=1
  else:db.get(Account,s['account']['id']).active=False
 assert c.post('/api/face/login/verify',json=body).status_code==400
 assert c.get('/api/session').status_code==401
def test_password_and_csrf_required(env):
 app,c,s=env;b={'password':PASSWORD,'enrollmentRoot':'123'}
 assert c.post('/api/face/enroll/options',json=b).status_code==403
 assert c.post('/api/face/enroll/options',json={**b,'password':'wrong'},headers={'x-csrf-token':s['csrf']}).status_code==401
def test_concurrent_replay_only_one_session(env):
 from concurrent.futures import ThreadPoolExecutor
 app,c,s=env;enroll(env);o=c.post('/api/face/login/options',json={'username':'alice'}).json();body={'challenge_id':o['challenge_id'],**prove(o)}
 def submit(_):
  with TestClient(app,headers=H) as other:return other.post('/api/face/login/verify',json=body).status_code
 with ThreadPoolExecutor(max_workers=2) as pool:codes=list(pool.map(submit,range(2)))
 assert sorted(codes)==[200,400]

def test_largest_generated_binding_version_is_persistable(env,monkeypatch):
 from app import face_login
 monkeypatch.setattr(face_login.secrets,'randbelow',lambda upper:upper-1)
 enroll(env)
 app,c,s=env
 with app.state.db() as db:
  assert db.get(Enrollment,s['account']['id']).version==2**31-1
