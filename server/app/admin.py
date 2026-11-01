"""Local operator recovery for existing accounts; no invitation or public reset endpoint."""
import argparse
import os
import secrets
from pathlib import Path
from sqlalchemy import select,update
from .config import Settings
from .database import Account,RecoveryCode,Challenge,connect
from .main import digest,now

def issue_recovery(factory,username,directory):
    # Only the local operator holding database access can use this utility.
    with factory.begin() as db:
        account=db.scalar(select(Account).where(Account.username==username.lower(),Account.active.is_(True)).with_for_update())
        if not account:raise ValueError('No active account with that username')
        code=secrets.token_urlsafe(32)
        record=db.get(RecoveryCode,account.id)
        if not record:record=RecoveryCode(account_id=account.id);db.add(record)
        record.digest,record.used,record.created_at=digest(code),False,now()
        db.execute(update(Challenge).where(Challenge.account_id==account.id,Challenge.operation=='recover').values(consumed=True))
        directory.mkdir(mode=0o700,parents=True,exist_ok=True)
        target=directory/(account.username+'-recovery-'+secrets.token_hex(4)+'.txt')
        fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as stream:stream.write(code+'\n')
    return target

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('username')
    args=parser.parse_args()
    engine,factory=connect(Settings.from_env().database_url)
    try:print('Private recovery code saved to '+str(issue_recovery(factory,args.username,Path(__file__).resolve().parents[2]/'data')))
    finally:engine.dispose()
