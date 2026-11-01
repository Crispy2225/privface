"""Explicit retention cleanup. Never removes active accounts, credentials, or bindings."""
import argparse
import json
import time
from sqlalchemy import delete, exists, select
from .config import Settings
from .database import Challenge, Invitation, LoginSession, RateBucket, connect


def cleanup(factory, retention_days=7):
    if not 1 <= retention_days <= 365:
        raise ValueError('Retention must be 1–365 days')
    cutoff=int(time.time())-retention_days*86400
    with factory.begin() as db:
        counts={}
        counts['challenges']=db.execute(delete(Challenge).where(Challenge.expires_at < cutoff)).rowcount
        counts['sessions']=db.execute(delete(LoginSession).where(LoginSession.expires_at < cutoff, ~exists(select(Challenge.id).where(Challenge.session_digest==LoginSession.digest)))).rowcount
        counts['invitations']=db.execute(delete(Invitation).where(Invitation.expires_at < cutoff)).rowcount
        counts['rate_buckets']=db.execute(delete(RateBucket).where(RateBucket.window < cutoff//60)).rowcount
    return counts

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--retention-days',type=int,default=7)
    args=parser.parse_args()
    engine,factory=connect(Settings.from_env().database_url)
    try: print(json.dumps(cleanup(factory,args.retention_days)))
    finally: engine.dispose()
