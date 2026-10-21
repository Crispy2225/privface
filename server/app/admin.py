"""Operator-created, account-specific, expiring invitations (never an HTTP endpoint)."""
import argparse
import secrets
import re
from sqlalchemy import select
from .config import Settings
from .database import Account, Invitation, connect
from .main import digest, now


def issue_invitation(factory, username, display_name, hours=24):
    username = username.lower()
    if not re.fullmatch(r'[a-z0-9_]{3,32}', username) or not display_name.strip() or len(display_name) > 80 or not 1 <= hours <= 168:
        raise ValueError('Invalid username, display name, or lifetime (1–168 hours)')
    token = secrets.token_urlsafe(32)
    with factory.begin() as db:
        if db.scalar(select(Account).where(Account.username == username)):
            raise ValueError('Username already reserved; invitations do not overwrite accounts')
        account = Account(username=username, display_name=display_name.strip())
        db.add(account)
        db.flush()
        db.add(Invitation(digest=digest(token), account_id=account.id, expires_at=now() + hours * 3600))
    return token

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('username')
    parser.add_argument('display_name')
    parser.add_argument('--hours', type=int, default=24)
    args = parser.parse_args()
    engine, factory = connect(Settings.from_env().database_url)
    try:
        print(issue_invitation(factory, args.username, args.display_name, args.hours))
    finally:
        engine.dispose()
