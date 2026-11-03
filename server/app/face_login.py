"""Local-only M4 research login. No camera or liveness claim."""
import hashlib,json,secrets
from pathlib import Path
from urllib.parse import urlparse
from fastapi import Request,Response
from pydantic import BaseModel,ConfigDict,Field
from sqlalchemy import select,update
from .database import Account,Enrollment,Challenge,LoginSession
from .passwords import verify_password
from .zkml_service import ZkMLVerifier

SCHEME='privface-zkml-demo-v1'
ROOT=Path(__file__).resolve().parents[2]
class Body(BaseModel):model_config=ConfigDict(extra='forbid')
class Enroll(Body):
    password:str=Field(min_length=1,max_length=128,repr=False)
    enrollmentRoot:str=Field(pattern=r'^[1-9][0-9]{0,76}$')
class Login(Body):username:str=Field(pattern=r'^[a-zA-Z0-9_]{3,32}$')
class Finish(Body):
    challenge_id:str=Field(min_length=36,max_length=36)
    proof:dict
    publicSignals:list[str]=Field(min_length=9,max_length=9)

def install(app,session,lock_account,new_challenge,consume,issue_session,limit,reject,now):
    verifier=ZkMLVerifier(app.state.settings.node_binary) if hasattr(app.state,'settings') else None
    def config():
        nonlocal verifier
        if urlparse(app.state.settings.origin).hostname not in ('localhost','127.0.0.1'):reject('Face demo is localhost-only',403)
        if verifier is None:verifier=ZkMLVerifier(app.state.settings.node_binary)
        try:
            pub=ROOT/'client/public/zkml';m=json.loads((pub/'manifest.json').read_text());praw=(pub/'policy.json').read_bytes();p=json.loads(praw)
            if m['modelSHA256']!=p['modelSHA256'] or hashlib.sha256(praw).hexdigest()!=m['files']['policy.json']['sha256']:raise ValueError()
            return m,p
        except (OSError,ValueError,KeyError):reject('Face proof setup unavailable',503)
    def snapshot(binding):return None if not binding else [binding.commitment,binding.version,binding.model,binding.scheme]
    def context(ch):return ch.payload['expected']
    def binding_ok(binding,ch):
        return snapshot(binding)==ch.payload['previous']
    @app.post('/api/face/enroll/options')
    def enroll(body:Enroll,request:Request):
        m,p=config()
        if int(body.enrollmentRoot)>=21888242871839275222246405745257275088548364400416034343698204186575808495617:reject('Invalid commitment')
        with app.state.db() as db:
            current,account=session(db,request,csrf=True);aid=account.id
        limit('face-password:'+aid,5)
        with app.state.db.begin() as db:
            current,account=session(db,request,csrf=True);account=lock_account(db,account.id);db.refresh(current)
            if current.revoked or current.expires_at<=now() or not account.active:reject()
            if not verify_password(body.password,account.password_hash):reject('Password incorrect',401)
            binding=db.get(Enrollment,account.id)
            # PostgreSQL enrollment.version is a signed 32-bit INTEGER.
            version=secrets.randbelow(2**31-1)+1
            ch=new_challenge(db,account.id,'face-enroll',session_digest=current.digest)
            expected=dict(account=str(int(account.id.replace('-',''),16)),nonce=str(int.from_bytes(ch.nonce[:31],'big') or 1),enrollmentRoot=body.enrollmentRoot,bindingVersion=str(version),operation='1',limit=p['limit'],modelTag=m['modelTag'],policyTag=m['policyTag'])
            ch.payload=dict(expected=expected,setupId=m['setupId'],model=m['modelSHA256'],previous=snapshot(binding))
            return dict(challenge_id=ch.id,inputs=expected,setupId=m['setupId'])
    @app.post('/api/face/login/options')
    def login(body:Login):
        m,p=config();limit('face-login:'+body.username.lower(),5)
        with app.state.db.begin() as db:
            account=db.scalar(select(Account).where(Account.username==body.username.lower(),Account.active.is_(True)))
            binding=db.get(Enrollment,account.id) if account else None
            if not account or not account.password_hash or not binding or binding.scheme!=SCHEME or binding.model!=m['modelSHA256']:reject('Face login unavailable; use password',401)
            ch=new_challenge(db,account.id,'face-login')
            expected=dict(account=str(int(account.id.replace('-',''),16)),nonce=str(int.from_bytes(ch.nonce[:31],'big') or 1),enrollmentRoot=str(int(binding.commitment,16)),bindingVersion=str(binding.version),operation='2',limit=p['limit'],modelTag=m['modelTag'],policyTag=m['policyTag'])
            ch.payload=dict(expected=expected,setupId=m['setupId'],model=m['modelSHA256'],previous=snapshot(binding))
            return dict(challenge_id=ch.id,inputs=expected,setupId=m['setupId'])
    def finish(body,request,response,operation):
        m,p=config();limit('face-verify:'+body.challenge_id,5)
        with app.state.db() as db:
            ch=db.get(Challenge,body.challenge_id)
            if not ch or ch.operation!=operation or ch.consumed or ch.expires_at<=now():reject()
            expected=context(ch);setup=ch.payload['setupId']
            if operation=='face-enroll':
                current,account=session(db,request,csrf=True)
                if ch.session_digest!=current.digest or ch.account_id!=account.id:reject()
        try:valid=verifier.verify(body.proof,body.publicSignals,expected=expected,setup_id=setup)
        except RuntimeError:reject('Verifier busy',503)
        if not valid:reject('Invalid face proof')
        with app.state.db.begin() as db:
            ch=consume(db,body.challenge_id,operation);account=lock_account(db,ch.account_id)
            m,p=config();binding=db.get(Enrollment,account.id)
            if not account.active or not account.password_hash or setup!=m['setupId'] or ch.payload['model']!=m['modelSHA256'] or expected['limit']!=p['limit'] or not binding_ok(binding,ch):reject('Authorization changed; start again')
            if operation=='face-enroll':
                current,owner=session(db,request,csrf=True);db.refresh(current)
                if current.revoked or current.expires_at<=now() or owner.id!=account.id or current.digest!=ch.session_digest:reject()
                if binding is None:binding=Enrollment(account_id=account.id);db.add(binding)
                binding.commitment=format(int(expected['enrollmentRoot']),'064x');binding.version=int(expected['bindingVersion']);binding.model=m['modelSHA256'];binding.scheme=SCHEME;binding.quantization='w256-a128-round-half-up-v1';binding.updated_at=now();binding.credential_id=None
                db.execute(update(Challenge).where(Challenge.account_id==account.id,Challenge.operation.in_(['face-login','face-enroll'])).values(consumed=True))
                return dict(bound=True,version=binding.version)
            result=issue_session(db,account,response,request)
            result['authentication']='face-proof-demo'
            # issue_session inserts a new pending row; mark its authentication method.
            for row in db.new:
                if isinstance(row,LoginSession):row.proof_context={'authentication':'face-proof-demo','model':m['modelSHA256'],'setup_id':setup}
            return result
    @app.post('/api/face/enroll/verify')
    def enroll_verify(body:Finish,request:Request,response:Response):return finish(body,request,response,'face-enroll')
    @app.post('/api/face/login/verify')
    def login_verify(body:Finish,request:Request,response:Response):return finish(body,request,response,'face-login')
