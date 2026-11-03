# M4 local face-login demonstration

Implemented on 2 November 2026 for the frozen M3 demo model. This is a localhost-only research login with no liveness assurance. The 70.56% calibration genuine acceptance is not a measured webcam success rate.

## Try it

Start the existing local development stack (`node tools/dev.mjs` from the repository root), then open `http://localhost:5173/face-login.html` or use the new Face login demo navigation link. Create an account through the normal app if needed.

1. Enter username and password. Start the laptop webcam or phone front camera, follow the movement instructions, and capture when ready. Capture requires exactly one face, usable framing, upright pose, open eyes, and sufficient light/detail. The detected face bounds determine a padded square crop, resized to 32x32 without stretching. Preview mirroring does not change the model pixels.
2. Choose Enroll / replace face. The password is rechecked, a server challenge is issued, and the browser proves enrollment before the server binds the commitment.
3. Sign out. Capture again and choose Log in with face. No password is required for this operation on the enrolled browser.
4. A valid proof creates a real HTTP-only session. After `/api/session` confirms the session, choose Continue to my account. Authentication is labelled `face-proof-demo`. Password fallback has the same confirmed-session continuation.

Existing center-square demo templates require password-authorized re-enrollment because the new crop format is `landmark-square-v1`. Enrollment remains browser-specific. Camera use on a phone requires a secure context (normally HTTPS); research proof loading is still restricted to localhost, so this change does not enable remote phone face authentication.

## Protocol

`/api/face/enroll/options` requires a valid session, CSRF token and current password. It snapshots the existing binding, generates a random nonzero 32-bit binding version and nonce, and binds the expected account/model/policy/setup/commitment/operation to the challenge. `/api/face/enroll/verify` verifies full inference and commitment before replacing enrollment.

`/api/face/login/options` issues signed-out login challenges for compatible enrolled accounts. `/api/face/login/verify` uses trusted stored public inputs, verifies outside the transaction, then atomically consumes the challenge and rechecks account activation, enrollment snapshot, model, policy and setup before issuing a session. Existing origin checks, request bounds and HTTP-only/SameSite cookies apply. Five-per-minute username login and challenge verification limits supplement the existing account/IP limits. A shared verifier instance limits expensive verification to two concurrent processes per API worker.

Expired, consumed, mismatched or invalid proofs cannot create a session. Replacing or removing a binding invalidates outstanding login challenges through snapshot checks. Password recovery and logout-all retain the existing session lifecycle. No new database migration is needed: existing enrollment/challenge/session tables are reused. Face-demo enrollment replaces the account's previous descriptor enrollment; legacy browser templates cannot be converted.

## Local storage and capture

The private template is AES-GCM encrypted in IndexedDB using a non-extractable, browser-generated CryptoKey. Each username is authenticated as additional data. This is same-browser device storage: it does not protect against malicious same-origin code, browser compromise or someone controlling the browser profile. It is not password-derived encryption. Template/camera data is never sent to the server; only the commitment, proofs and public context leave the browser. Password-authorized enrollment uses the existing password endpoint.

Replacement enrollment is staged separately so a failed proof does not overwrite the old local template. A staged template can be recovered on login if the server accepted enrollment before a browser interruption. Forget local template removes local active and pending records; use the existing password-confirmed Remove face binding action to revoke server enrollment. Clearing browser data requires re-enrollment.

Camera tracks stop after capture, success, explicit stop, page hiding and navigation; a late permission grant is also released after cancellation. Captures expire after one minute and are cleared on username changes. Proofs can be cancelled and workers have timeouts. The camera check requires the existing randomized blink/head-turn sequence and revalidates the actual capture frame. These client-side checks are not attested or proved by the server: arbitrary pixels can still satisfy the mathematical relation. The demo makes no presentation-attack resistance claim.

Framing and head-tilt calculations account for portrait/landscape dimensions. Both the account camera and face-login camera check a consistently sized face region for gross underexposure, clipping, low contrast and blur. These are provisional capture heuristics, not calibrated identity thresholds. The model, proof circuit and matching threshold are unchanged. No webcam recognition gain has been measured; validate genuine acceptance and impostor acceptance on consented, held-out participants across devices, lighting and separate sessions before changing the matching policy.

## Validation

- 28 existing backend tests passed.
- 6 new tests passed using real Groth16 proofs: signed-out session issuance, tampered proof rejection, enrollment/login replay rejection, stale binding, expiry, disabled account, password/CSRF checks and concurrent replay (exactly one session).
- Updated headless Chrome checks pass in laptop landscape and phone portrait layouts: the real detector rejects generated non-face video; stopped and late-granted streams are released; mocked password failure/success and session confirmation control the continue link. These are not physical-device or biometric-accuracy tests. The previous synthetic-grid face-login smoke test is superseded because non-face captures are now rejected by the UI.
- 44 client tests, TypeScript checking and the Vite production build pass. Six backend tests pass with real Groth16 proofs against disposable SQLite databases.
- Physical webcam, actual-user recognition, PostgreSQL concurrent execution and production security review remain unverified.

Run `PYTHONPATH=server server/.venv/bin/python -m pytest server/tests/test_face_login.py -q` after generating M3 artifacts. Node must be installed (or set NODE_BINARY). The proof helper in zk/scripts/m4-test-proof.mjs uses synthetic grids only; it is not an HTTP endpoint or authentication bypass.

Run `npm --prefix client run test:face-camera` against a running app or production preview. Set `M4_TEST_ORIGIN` for the origin and, if needed, `PLAYWRIGHT_MODULE` and `CHROME_PATH`. Browser checks use generated pixels and mocked password API responses; run the backend tests separately for real proof/session verification.
