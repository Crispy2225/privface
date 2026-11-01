"""Real Groth16 API tests using synthetic descriptors, never webcam evidence."""
import json
import os
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from app.config import Settings, MODEL, QUANTIZATION
from app.database import Base, Challenge, Enrollment
from app.main import create_app, now
from test_auth import register, HEADERS
ROOT=Path(__file__).resolve().parents[2]
NODE=os.getenv('NODE_BINARY','node')
@pytest.fixture
def proof_app(tmp_path):
    if not (ROOT/'zk/artifacts/browser-manifest.json').exists(): pytest.skip('Run zk setup and prepare-browser first')
    app=create_app(Settings(os.getenv('TEST_DATABASE_URL','sqlite:///'+str(tmp_path/'proof.sqlite')),proof_enabled=True,node_binary=NODE))
    Base.metadata.create_all(app.state.engine)
    yield app
    Base.metadata.drop_all(app.state.engine);app.state.engine.dispose()

def private_input(account):
    values=list(range(32769,32897))
    source="import {commitment} from './zk/scripts/common.mjs';console.log(await commitment(process.argv[1],JSON.parse(process.argv[2]),'123456789'));process.exit(0)"
    root=subprocess.check_output([NODE,'--input-type=module','-e',source,account,json.dumps(values)],cwd=ROOT,text=True).strip()
    return {'enrolled':values,'probe':values,'blinding':'123456789'},root

def prepare(app,client):
    session=register(app,client)
    private,root=private_input(str(int(session['account']['id'].replace('-',''),16)))
    headers={'x-csrf-token':session['csrf']}
    binding={'commitment':f'{int(root):064x}','scheme':'poseidon-int16-v1','model':MODEL,'quantization':QUANTIZATION}
    options=client.post('/api/enrollment/options',json=binding,headers=headers)
    assert options.status_code==200,options.text
    assert client.post('/api/enrollment/verify',json=options.json(),headers=headers).status_code==200
    options=client.post('/api/proof/options',json={},headers=headers)
    assert options.status_code==200,options.text
    options=options.json()
    result=subprocess.run([NODE,str(ROOT/'zk/scripts/prove-input.mjs')],input=json.dumps({**options['inputs'],**private}),text=True,capture_output=True,check=True,timeout=60)
    return headers,{'challenge_id':options['challenge_id'],**json.loads(result.stdout)}

def test_valid_proof_context_and_concurrent_replay(proof_app):
    with TestClient(proof_app,headers=HEADERS) as client:
        assert client.post('/api/proof/options',json={}).status_code==401
        headers,payload=prepare(proof_app,client)
        assert client.post('/api/proof/verify',json=payload).status_code==403
        # Alter each expected public input: proof must fail before nonce consumption.
        for index in range(1,6):
            changed={**payload,'publicSignals':list(payload['publicSignals'])};changed['publicSignals'][index]=str(int(changed['publicSignals'][index])+1)
            assert client.post('/api/proof/verify',json=changed,headers=headers).status_code==400
        bad={**payload,'proof':{}}
        assert client.post('/api/proof/verify',json=bad,headers=headers).status_code==400
        cookies=dict(client.cookies)
        def send(_):
            with TestClient(proof_app,headers={**HEADERS,**headers},cookies=cookies) as c:return c.post('/api/proof/verify',json=payload).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:codes=list(pool.map(send,range(2)))
        assert sorted(codes)==[200,400]
        assert client.get('/api/session').json()['descriptor_proof']['circuit']=='face-match-v1'
        assert client.post('/api/proof/verify',json=payload,headers=headers).status_code==400
        with proof_app.state.db.begin() as db:db.execute(update(Enrollment).values(version=2))
        assert client.get('/api/session').json()['descriptor_proof'] is None

@pytest.mark.parametrize('change',['expired','binding','account','session','policy'])
def test_stale_proof_context_rejected(proof_app,change,tmp_path):
    with TestClient(proof_app,headers=HEADERS) as client:
        headers,payload=prepare(proof_app,client)
        if change=='expired':
            with proof_app.state.db.begin() as db:db.execute(update(Challenge).where(Challenge.id==payload['challenge_id']).values(expires_at=now()-1))
        elif change=='binding':
            with proof_app.state.db.begin() as db:db.execute(update(Enrollment).values(version=2))
        elif change=='account':
            other=register(proof_app,client,'bobby');headers={'x-csrf-token':other['csrf']}
        elif change=='session':client.post('/api/logout',json={},headers=headers)
        else:
            path=tmp_path/'policy.json';path.write_text(json.dumps({'model':MODEL,'quantization':QUANTIZATION,'threshold':0.4,'calibrated':False}));proof_app.state.proofs.policy_path=path
        assert client.post('/api/proof/verify',json=payload,headers=headers).status_code in (400,401)
