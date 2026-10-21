"""Explicit origin/RP settings; no production fallback database or secrets."""
import os
from dataclasses import dataclass
from urllib.parse import urlparse

MODEL = 'face-api.js@0.22.2/faceRecognitionNet/128-v1'
QUANTIZATION = 'int16-s4096-v1'
COMMITMENT = 'sha256-blinded-v1'

@dataclass(frozen=True)
class Settings:
    database_url: str
    origin: str = 'http://localhost:5173'
    rp_id: str = 'localhost'
    secure_cookie: bool = False
    challenge_seconds: int = 120
    session_seconds: int = 3600

    def __post_init__(self):
        parsed = urlparse(self.origin)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('APP_ORIGIN must be an exact origin without a path')
        if parsed.hostname != self.rp_id and not parsed.hostname.endswith('.' + self.rp_id):
            raise ValueError('RP_ID must match the origin host or its parent domain')
        if parsed.hostname not in ('localhost', '127.0.0.1') and (parsed.scheme != 'https' or not self.secure_cookie):
            raise ValueError('Non-local deployments require HTTPS and secure cookies')
        if self.secure_cookie and parsed.scheme != 'https':
            raise ValueError('Secure cookies require HTTPS')

    @classmethod
    def from_env(cls):
        url = os.environ.get('DATABASE_URL')
        if not url:
            raise ValueError('Set DATABASE_URL, run migrations, then start the API. See docs/IMPLEMENTATION.md.')
        return cls(url, os.getenv('APP_ORIGIN', 'http://localhost:5173'), os.getenv('RP_ID', 'localhost'), os.getenv('COOKIE_SECURE', 'false').lower() == 'true')
