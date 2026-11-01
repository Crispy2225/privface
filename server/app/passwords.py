"""Salted scrypt password hashes; bounded work and constant-time comparison."""
import hashlib
import hmac
import secrets
import threading

_slots=threading.BoundedSemaphore(2)
def _derive(password,salt):
    if not _slots.acquire(blocking=False):
        from fastapi import HTTPException
        raise HTTPException(503,'Password verification is busy. Please retry shortly.')
    try:return hashlib.scrypt(password.encode('utf-8'),salt=salt,n=32768,r=8,p=3,dklen=32,maxmem=64*1024*1024)
    finally:_slots.release()
def hash_password(password):
    salt=secrets.token_bytes(16)
    return 'scrypt-v1$'+salt.hex()+'$'+_derive(password,salt).hex()
def verify_password(password,stored):
    try:
        tag,salt,expected=stored.split('$')
        if tag!='scrypt-v1' or len(salt)!=32 or len(expected)!=64:return False
        return hmac.compare_digest(_derive(password,bytes.fromhex(salt)),bytes.fromhex(expected))
    except (AttributeError,ValueError):return False
