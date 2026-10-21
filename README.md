# PrivFace — local face matching and passkey-authorized accounts

PrivFace keeps face images and templates on the device. The browser provides camera validation, experimental movement/liveness checks, local embedding extraction, encrypted enrollment, and fixed-point face comparison. A FastAPI server supports invitation-based account setup, verified WebAuthn passkeys, sessions, and versioned blinded template commitments with expiring, single-use challenges. PostgreSQL is the primary database; an explicit SQLite fallback supports local development.

**Read [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for complete setup commands, a browser walkthrough, architecture, file map, evaluation instructions, security boundaries and test results.**

## Current boundaries

- Server access is authorized by passkeys. A local face match is not trusted server authentication.
- The matching threshold is provisional until calibrated and tested on consented participant data.
- Existing weights use mixed UINT8/FLOAT32 storage. An all-UINT8 storage experiment and INT16 descriptor comparison are included; neural inference remains FLOAT32.
- ZK proof generation/verification, trusted camera provenance, biometric accuracy and spoof resistance are not established.
- The separate account and binding protocol is summarized in [docs/enrollment-binding.md](docs/enrollment-binding.md).

## Layout

- `client/`: React, TypeScript, Vite, MediaPipe, face-api.js, Web Crypto and IndexedDB.
- `server/`: FastAPI, SQLAlchemy, Alembic, psycopg and py_webauthn.
- `compose.yaml`: loopback PostgreSQL service with persistent storage.
- `docs/`: implementation guide and reproducible quantization reports.

## Run and test

Install the dependencies, configure the database, and run migrations as described in the implementation guide before starting the API. Open the client at **http://localhost:5173** to match the default WebAuthn origin/RP ID. No secrets or invitations should be committed.

```sh
# After configuring DATABASE_URL, APP_ORIGIN, RP_ID and COOKIE_SECURE:
server/.venv/bin/alembic -c server/alembic.ini upgrade head
server/.venv/bin/python -m uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8000
# In a second terminal:
npm --prefix client run dev
```

```sh
npm --prefix client test
npm --prefix client run build
PYTHONPATH=server server/.venv/bin/pytest server/tests -q
```

The guide explains how to issue account-specific invitations, create passkeys, authorize local-template bindings, and evaluate matching without uploading biometric data. Existing schema-1 local enrollments remain compatible on the same browser origin/profile.
