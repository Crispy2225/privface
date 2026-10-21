# PrivFace implementation guide — 21 October 2026

This guide describes the implementation added for face matching, quantization experiments, server accounts, authorized enrollment, and replay prevention. It supersedes the earlier milestone descriptions in `ISL.pdf` and the old README. Existing encrypted local templates remain readable.

## 1. What you can do now

1. Save a face enrollment locally using the existing camera/liveness flow.
2. Capture a new photo and compare it with the saved template locally.
3. Create a server account using an operator-issued invitation and a passkey.
4. Sign in to that account with a cryptographically verified passkey.
5. Authorize a commitment to the saved face template using a fresh passkey assertion.
6. Use a PostgreSQL database for accounts, credentials, bindings, expiring challenges, sessions, and rate limits.
7. Reproduce model storage measurements, generate an all-UINT8 weight-storage variant, and evaluate matching thresholds on a supplied consented study dataset.

**Server authentication is passkey authentication.** The face comparison is a local convenience gate in the face-login flow. The independent passkey button intentionally works without face comparison. An altered browser can bypass local matching, so the API never accepts a boolean face/liveness result as authority. No ZK proof generation or verification has been implemented in this change.

### Honest status of the five requested parts

| Requested part | Implemented | Still needs evidence or follow-up |
| --- | --- | --- |
| Face matching | Load/decrypt template; extract fresh descriptor; fixed-point Euclidean comparison; UI success/failure; calibration/evaluation pipeline | A participant dataset is needed to choose and validate an actual threshold. The checked-in 0.5 threshold is explicitly provisional. |
| Quantization | Audit existing mixed UINT8/FLOAT32 weights; quantize the remaining FLOAT32 tensors into a separate all-UINT8 model; load/inference smoke check; INT16 descriptor comparison | Neural inference still uses FLOAT32 after weight loading. Integer-only neural inference and biometric accuracy of the experimental model are not established. |
| Accounts/database | PostgreSQL-compatible schema, Alembic migration, invitation CLI, account/credential/session records, working APIs | Production database provisioning and operational recovery procedures remain deployment work. |
| Authorized enrollment | Account-specific invitation, required passkey user verification, blinded commitment, encrypted local opening, fresh assertion to authorize versioned binding | SHA-256 commitment is versioned but not yet integrated into a proof circuit. Camera provenance is not attested. |
| Replay prevention | Random nonces, 120-second expiry, account/operation/credential/session binding, atomic consumption, negative and concurrent replay tests | These protections currently cover WebAuthn ceremonies. A future ZK circuit must also bind and consume its own server challenge. |

## 2. Start the project

Use Node.js 22.12+ (Node 24 recommended) and Python 3.12. All commands below are from the repository root unless stated otherwise.

### Install dependencies

```sh
python3.12 -m venv server/.venv
server/.venv/bin/python -m pip install -r server/requirements-dev.txt
npm --prefix client ci
```

Use `server/requirements.txt` instead of `requirements-dev.txt` if you do not need pytest/httpx. On this Mac, the bundled Python fallback is:

```sh
/Users/atharv/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m venv server/.venv
```

The pinned dependencies were installed into this project's existing `server/.venv` during implementation. Use the commands above when setting up a fresh checkout. A persistent application database has not been provisioned; choose PostgreSQL or the explicit local fallback below.

### PostgreSQL (recommended)

Install/start Docker if it is not available, or use an existing PostgreSQL server. The supplied Compose file starts **only PostgreSQL**, bound to loopback, with a persistent named volume. It does not deploy the application.

```sh
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
docker compose up -d db
export DATABASE_URL="postgresql+psycopg://privface:${POSTGRES_PASSWORD}@localhost:5432/privface"
export APP_ORIGIN=http://localhost:5173
export RP_ID=localhost
export COOKIE_SECURE=false
server/.venv/bin/alembic -c server/alembic.ini upgrade head
server/.venv/bin/python -m uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8000
```

Keep the generated database password in a private local environment configuration. Do not generate a new password for an existing Compose volume: PostgreSQL initialization variables only initialize a new volume. Never commit it. If a password contains reserved URL characters, URL-encode it in `DATABASE_URL`.

The application reads exported variables, not `.env` automatically. `server/.env.example` lists the settings. No migration or account creation runs implicitly on startup.

### SQLite fallback for local development only

If PostgreSQL/Docker is unavailable, the same APIs can be exercised with an explicit SQLite file:

```sh
mkdir -p data
export DATABASE_URL="sqlite:///$PWD/data/privface.sqlite"
export APP_ORIGIN=http://localhost:5173
export RP_ID=localhost
export COOKIE_SECURE=false
server/.venv/bin/alembic -c server/alembic.ini upgrade head
server/.venv/bin/python -m uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8000
```

SQLite is a development fallback, not a PostgreSQL provisioning step. The ignored `data/` directory must not contain files committed to Git.

### Frontend

In another terminal:

```sh
npm --prefix client run dev
```

Open **http://localhost:5173**. Use `localhost` consistently, even if Vite prints `127.0.0.1`. Passkeys bind to the RP ID and exact origin; browser storage also differs between hostnames. Old enrollments at `127.0.0.1:5173` are not automatically copied to `localhost:5173`.

For production, set `APP_ORIGIN` to the exact HTTPS origin, set the matching `RP_ID`, enable `COOKIE_SECURE=true`, and serve frontend/API on the same origin. Do not use wildcard CORS. Configure trusted proxy forwarding explicitly if deploying behind a proxy; the app's rate limiter uses the request client address. Vite's development proxy is not production hosting.

## 3. Create and use an account

### Issue an invitation

In a shell with the same `DATABASE_URL` exported:

```sh
PYTHONPATH=server server/.venv/bin/python -m app.admin atharv "Atharv Borle"
```

This reserves the case-insensitive username and prints a random invitation token once. The database retains only its SHA-256 digest. Default lifetime: 24 hours; `--hours` accepts 1–168 hours. Give the token only to its intended account owner through a trusted channel. The operator is responsible for deciding whom to invite; there is no email delivery or identity-proofing service.

An invitation is bound to one reserved account. It cannot overwrite an existing username, and one successful registration consumes it. Keep invitations out of screenshots, source control, URLs, and logs.

### Browser walkthrough

1. Paste the token into **Server account → Account invitation**.
2. Select **Create account with passkey** and complete your browser/OS authenticator prompt. User verification is required.
3. The app uses the server-authorized username/display name. Choose **Register**, enter the same username if needed, complete the face capture, consent, and save locally.
4. Select **Bind saved face enrollment** in the server-account panel. A fresh passkey prompt authorizes this exact commitment. The server now records a versioned binding.
5. Sign out. For the face flow, enter the username, capture a new photo, then select **Compare face & continue with passkey**. A local match leads to the passkey prompt; a mismatch shows feedback.
6. The standalone **Sign in with passkey for entered username** button is available even when local enrollment has been lost. It uses the same authoritative server authentication.

Binding an enrollment does not upload its descriptor. Deleting the local enrollment deletes its key and local commitment openings. It does not delete the account or its server commitment, or revoke the passkey. To replace a lost/re-enrolled template, sign in with the passkey and authorize a new binding; the server increments the version. Recovery from a lost passkey and additional passkeys per account are not implemented yet.

## 4. Face matching explained

### Existing capture and storage pipeline

MediaPipe runs locally on frames downscaled to at most 640 pixels wide, approximately ten observations per second. It requires one centered face with valid framing. The movement prototype asks for randomized bilateral eye closure/reopening and left/right head turns with returns to neutral. Missing/multiple faces, invalid framing, abrupt movement, timeouts and video gaps above 650 ms reset progress. Capture permission lasts six seconds and requires observations within 500 ms; the exact captured canvas frame is checked again before JPEG encoding.

Photos stay in React memory and are cleared on navigation, tab hiding, retake/discard or successful enrollment. The camera requests video only, and cleanup stops its tracks. Recognition uses local Tiny Face Detector, tiny 68-point alignment and the pretrained 128-D recognition network. Model assets are same-origin; predev/prebuild verify pinned checksums and prepare local WASM. Consent is required before persistent encrypted enrollment. Duplicate usernames cannot overwrite existing records.

These movement checks are heuristics. Replay videos, virtual cameras and modified clients are not proven to be resisted. IndexedDB holds the AES-GCM key beside the ciphertext: a malicious same-origin script can use that key. Non-extractable keys are not hardware-backed biometric storage.

### Comparison


`client/src/LocalVerification.tsx` retrieves a template by normalized username through `getEnrollment()`, decrypts it with the existing AES-GCM routine, extracts a fresh 128-dimensional descriptor, and calls `compareFaces()`.

The matching representation is:

```text
q[i] = round(embedding[i] * 4096), stored in a signed INT16 array
D = sum((q_enrolled[i] - q_probe[i])²)
accept locally if D <= floor((threshold * 4096)²)
```

Invalid length, non-finite values, zero vectors, and out-of-range values fail; there is no silent clipping. No descriptor normalization is introduced. Integer sums fit exactly in JavaScript's safe-integer range. The maximum per-component rounding error is 0.0001220703125; the mathematical bound on pair-distance drift is about 0.00276214.

The original encrypted template is retained unchanged for backward compatibility. The 256-byte INT16 representation is used in matching and commitment computation; it is **not** a claim that the existing encrypted JSON records occupy 256 bytes.

`client/src/match-policy.json` identifies the model, quantization, threshold, and whether calibration occurred. It currently says `calibrated: false`, and the UI displays that limitation. A successful local comparison is not an identity-proofing result.

## 5. Calibrate and evaluate with real study data

No biometric dataset was supplied, and no accuracy numbers were invented. The pipeline below makes the missing experiment reproducible.

### Collect/extract samples

With the development server running, open `http://localhost:5173/tests/evaluation.html`.

Use consented, separate enrollment/verification captures under varied lighting, cameras, poses, and glasses. Name files as follows:

```text
calibration__personA__session1__sample1.jpg
calibration__personA__session2__sample2.jpg
calibration__personB__session1__sample1.jpg
...
test__personX__session1__sample1.jpg
test__personX__session2__sample2.jpg
test__personY__session1__sample1.jpg
```

Use distinct subjects in the calibration and held-out test splits. The extraction page processes files locally with the baseline recognition model. It requires explicit export consent and downloads descriptors, identifiers, and per-image extraction durations. The first image's timing includes model loading; these timings are not a controlled latency benchmark. Uploaded-file study extraction does not test camera liveness.

Save the exported private dataset under `data/`, for example `data/private-evaluation.json`. This is sensitive biometric material; do not commit or casually share it.

### Compute a threshold and metrics

```sh
npm --prefix client run evaluate:matching -- "$PWD/data/private-evaluation.json" "$PWD/data/evaluation-report.json" 0.01
```

The final argument is the target empirical calibration FAR (default 1%). The evaluator:

- Rejects subject overlap between calibration and test splits, duplicate sample IDs, incompatible model IDs, and invalid descriptors.
- Builds unique pairs within each split. Same-subject genuine pairs must come from different sessions. Different-subject pairs are impostors.
- Requires at least 20 genuine and 20 impostor pairs **in each split**. This is only a minimum to prevent trivial experiments, not a statistically sufficient study size.
- Chooses the threshold using calibration data only: minimize false rejections subject to the target false-acceptance constraint, preferring the smaller threshold on ties.
- Reports held-out FAR/FRR, raw false-accept/reject counts, ROC points, floating-point comparison at the same threshold, and fixed-point rounding/distance drift.

Review the held-out results and retain the study protocol, participant counts, conditions, and device information. Pairs share subjects/images and are correlated; zero observed false accepts does not imply zero real-world risk. Do not repeatedly tune on the held-out split.

If the evaluated trade-off is acceptable, copy **only the report's `policy` object** into `client/src/match-policy.json`, retain the non-biometric experiment summary separately, and rebuild. The script deliberately does not change the application's policy automatically. Template values and individual distances should remain private.

## 6. Quantization: actual measurements and experiment

### Existing assets

The previous milestone description was too broad about quantization: the checked-in model already contains quantized weights, but not every recognition tensor is quantized.

`docs/quantization-audit.json` was generated from the actual manifests and shard sizes:

| Model | Stored weight bytes | Equivalent FLOAT32 bytes |
| --- | ---: | ---: |
| Tiny face detector | 193,321 | 773,284 |
| Tiny landmark model | 77,224 | 308,896 |
| Recognition model | 6,444,032 | 22,458,368 |

The recognition network has 5,614,592 parameters: 5,338,112 are stored as UINT8 and 276,480 remain FLOAT32. Its baseline weight-storage reduction against FLOAT32 is about 71.31%.

```sh
npm --prefix client run audit:quantization
```

### All-UINT8 storage experiment

```sh
node client/scripts/quantize-recognition.mjs "$PWD/client/public/vision/recognition-int8"
node client/scripts/check-quantized-model.mjs "$PWD/client/public/vision/recognition-int8"
```

The first script preserves already-quantized tensors and converts the remaining eight FLOAT32 tensors with per-tensor min/max affine quantization. It produces separate model assets, attribution, and an error report. The baseline checked-in model and existing enrollments are unchanged. Generated experimental assets are ignored by Git and can be reproduced.

The resulting recognition weights occupy **5,614,592 bytes**, a reduction of **829,440 bytes (about 12.87%)** from the current baseline, or 75% from equivalent FLOAT32 storage. `docs/quantization-experiment.json` records each converted tensor's maximum reconstruction error and RMSE, plus the artifact checksum.

The second script loads those weights into the real recognition network and runs inference on a zero-valued 150×150 RGB tensor. It returned 128 finite values; `docs/quantized-model-smoke.json` records this software smoke test. Its single-run timing is not a performance benchmark and the tensor is not a real face.

**Both model variants dequantize their stored weights into FLOAT32 for neural inference.** This experiment does not implement integer-only neural layers, train a new lightweight architecture, prove accuracy preservation, or establish faster inference. The all-UINT8 variant is experimental and is not selected by enrollment. Deploying it requires a new model ID, biometric comparison/calibration, and a re-enrollment/migration decision. This separation prevents silently invalidating existing templates.

## 7. Database and authentication protocol

### Tables

| Table | Purpose |
| --- | --- |
| `accounts` | Random account ID, unique normalized username, display name, active state |
| `invitations` | Account-specific token digest, expiry, used flag |
| `credentials` | Unique passkey credential ID, account FK, COSE public key, signature counter; currently one credential/account |
| `sessions` | Hashed session token, account FK, CSRF secret, expiry and revoked flag |
| `challenges` | Random nonce, operation, account/credential/session FKs, immutable pending payload, expiry, consumed flag |
| `enrollments` | Current account-to-commitment binding, version, credential, model/quantization/scheme IDs |
| `rate_buckets` | Shared atomic fixed-window request counters |

The initial Alembic migration is `server/migrations/versions/e12c88d6f2e9_accounts_credentials_bindings_.py`. Run migrations explicitly. Test database initialization uses the same SQLAlchemy schema; integration tests drop their tables, so never set `TEST_DATABASE_URL` to a real account database.

### Registration

1. An operator reserves an account and issues its secret invitation.
2. `/api/accounts/options` validates the invitation and creates a random registration challenge for that account.
3. The browser creates a passkey with required user verification.
4. `/api/accounts/verify` checks the actual WebAuthn response with `py_webauthn`, including challenge, origin, RP ID, ceremony and verification flags.
5. In the same transaction, the server consumes the invitation/challenge, stores the credential, activates the account, and creates a session.

This is invitation-based account authorization, not a claim of civil identity or trusted facial capture.

### Binding a face template

1. The browser decrypts the stored template locally and quantizes its descriptor.
2. It generates a random 32-byte blinding secret and computes:

```text
SHA256(UTF8(JSON.stringify([
  "privface-enrollment",
  "sha256-blinded-v1",
  accountId,
  "face-api.js@0.22.2/faceRecognitionNet/128-v1",
  "int16-s4096-v1",
  quantizedDescriptorArray,
  lowercaseHexBlindingSecret
])))
```

3. Before contacting the API, it encrypts the blinding secret using the local template key, fresh AES-GCM IV, and authenticated account/username/commitment metadata. The sealed opening lives in IndexedDB `privface-bindings/openings`; the template stays in `privface-enrollment/templates`.
4. `/api/enrollment/options` requires the session and CSRF secret. It stores the exact proposed commitment and versions with a fresh challenge, account, credential and session reference.
5. A fresh passkey assertion authorizes the challenge. `/api/enrollment/verify` gets the commitment from the pending server record, never from a replacement finish-request field. It atomically consumes the challenge and saves/increments the binding.

Only the commitment and public version labels cross the API. The image, descriptor, template encryption key and blinding secret do not. This is a blinded hash commitment, not a ZK proof. Circuit efficiency/compatibility is not yet established and the scheme is explicitly versioned for future replacement.

A failed/cancelled binding may leave an encrypted unused opening locally; retrying creates a fresh one. Deleting the local template removes its openings as well. The two IndexedDB databases do not provide a cross-database transaction: if deletion fails, retry it. A network failure after server commit can leave an uncertain UI result; reloading `/api/session` shows the recorded binding.

### Replay prevention and sessions

- Nonces contain 32 random bytes and expire after 120 seconds.
- Challenges are tied to one operation (`register`, `login`, `enroll`), account and credential. Enrollment is also tied to the initiating session.
- `UPDATE ... WHERE consumed=false AND expires_at>now RETURNING ...` consumes a challenge atomically. Consumption and account/session/binding changes commit together.
- Failed verification rolls back that transaction; the challenge can be retried within its lifetime, under rate limiting. A successful challenge cannot be reused.
- The verifier checks signatures, challenge, RP ID, exact origin, required user verification and applicable signature counters. Counterless authenticators are handled by the library's WebAuthn rules.
- Session secrets contain 32 random bytes; only their digests are stored. Cookies are HttpOnly, SameSite=Strict, `/api` scoped, and Secure when configured. Sessions expire after one hour. Login rotates the current browser session; logout revokes it.
- All POSTs require the configured exact Origin plus a custom request header. Authenticated state changes also require the session's CSRF secret. Request bodies are capped at 32 KiB.
- Persistent fixed-window limits are 60 POSTs per client address per minute and 12 challenge creations per account per minute. Limits apply across workers. A fixed window can allow bursts near the minute boundary.

The schema currently retains expired challenge/session/rate records. Add a retention/cleanup policy before prolonged deployment. Expired data cannot authorize requests, but it still occupies database space.

## 8. API reference

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Service availability only |
| `POST /api/accounts/options` | Invitation → registration challenge/options |
| `POST /api/accounts/verify` | Verify passkey registration; create account session |
| `POST /api/login/options` | Username → authentication challenge/options |
| `POST /api/login/verify` | Verify passkey assertion; create/rotate session |
| `GET /api/session` | Current account, CSRF token and current binding metadata |
| `POST /api/logout` | Revoke current session |
| `POST /api/enrollment/options` | Store an authenticated pending commitment and challenge |
| `POST /api/enrollment/verify` | Verify fresh passkey assertion; version the binding |

Registration and login verification accept `{challenge_id, credential}`. Enrollment verification accepts the same shape and requires the existing session/CSRF token. There is no `/verify-face` or proof-verification endpoint that could falsely authenticate a face.

## 9. File map

| Files | Responsibility |
| --- | --- |
| `client/src/face-match.ts` | Fixed-point quantization and matching |
| `client/src/match-policy.json` | Model-specific acceptance policy |
| `client/src/calibration.ts`, `client/scripts/evaluate-matching.mjs` | Threshold selection and held-out metrics |
| `client/tests/evaluation.html`, `evaluation.ts` | Local study-image extraction/export |
| `client/src/LocalVerification.tsx` | New capture → comparison → passkey flow |
| `client/src/AccountAccess.tsx`, `passkeys.ts` | Account UI, WebAuthn encoding, API calls |
| `client/src/template-binding.ts` | Blinded commitment and encrypted opening persistence |
| `client/src/enrollment-store.ts` | Added template retrieval and opening cleanup |
| `client/scripts/audit-quantization.mjs` | Model size/format audit |
| `client/scripts/quantize-recognition.mjs`, `check-quantized-model.mjs` | Experimental weight quantization and inference check |
| `server/app/config.py`, `database.py` | Configuration, schema and engine |
| `server/app/main.py` | Authentication, session, binding and replay protections |
| `server/app/admin.py` | Operator invitation CLI |
| `server/migrations/`, `server/alembic.ini` | Versioned database migration |
| `compose.yaml` | Local PostgreSQL service |
| `server/tests/test_auth.py` | Cryptographic API and concurrency tests |
| `client/tests/passkey-smoke.mjs` | Real browser integration with a virtual authenticator |

## 10. Validation and how to repeat it

```sh
npm --prefix client test
npm --prefix client run build
PYTHONPATH=server server/.venv/bin/pytest server/tests -q
server/.venv/bin/alembic -c server/alembic.ini check
```

For PostgreSQL integration, create a **disposable test database** and export `TEST_DATABASE_URL` before pytest. The suite creates and drops the application tables. Do not use a production or personal account database.

Recorded during this implementation:

- 37 client tests passed: original lifecycle/liveness/crypto/storage cases plus matching, range rejection, commitment binding, encrypted opening cleanup and calibration leakage checks.
- 22 server tests passed on both SQLite and a disposable PostgreSQL 18.4 instance. PostgreSQL migration and Alembic schema-drift checks also passed. The supplied Compose file uses PostgreSQL 17; that exact container image was not run here.
- TypeScript checks and the production build passed. Existing face-api.js bundle-size and browser `fs` externalization warnings remain.
- A headless Chrome test with a virtual authenticator passed registration, synthetic encrypted local enrollment, authorized binding, logout and login, without page errors.
- Quantization audit and all-UINT8 synthetic inference check passed.
- No real webcam, participant matching, physical Touch ID/security-key ceremony, spoof dataset, or full-integer inference benchmark was performed.

The server tests use actual elliptic-curve signatures and CBOR WebAuthn registration data through the production verifier; they do not replace it with a verifier that always returns true. Cases include incorrect origin/RP/challenge/credential/signature/user handle, absent user verification, malformed responses, expiry, reused invitations/challenges, cross-account/session/operation binding, CSRF, body limits, rate limits, and concurrent replay.

To run the browser smoke script, provide a fresh invitation file, a running app, and an installed Playwright package. The test creates a synthetic local template, so use a disposable account/browser/database:

```sh
PRIVFACE_URL=http://localhost:5173 \
PRIVFACE_INVITATION_FILE=/absolute/path/to/private-invitation.txt \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node client/tests/passkey-smoke.mjs
```

If Playwright's bundled Chromium is installed, omit `CHROME_PATH`. Do not publish the invitation file. It is not part of the repository.

## 11. Next work after this change

1. Collect consented real-camera genuine/impostor and presentation-attack data; calibrate and validate the model-specific threshold.
2. Evaluate the all-UINT8 storage variant on the same study; decide whether full-integer inference requires a different runtime/model.
3. Design and implement the actual ZK relation, proving framework, and server verifier. Do not equate a descriptor-distance proof with a proof of neural inference or live camera provenance.
4. Add credential recovery/additional passkeys, account/binding revocation, retention cleanup, deployment CSP/HTTPS, and operational monitoring before production use.

## References used for implementation

- [py_webauthn registration documentation](https://duo-labs.github.io/py_webauthn/registration.html) and [library source](https://github.com/duo-labs/py_webauthn)
- [face-api.js upstream model documentation](https://github.com/justadudewhohacks/face-api.js)
- [Embedded PostgreSQL test runtime](https://github.com/leinelissen/embedded-postgres) — temporary test tooling, not an application dependency
