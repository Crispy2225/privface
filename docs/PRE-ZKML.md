# PrivFace: implemented work and next measurements

> Authentication update: [PASSWORD-REGISTRATION.md](PASSWORD-REGISTRATION.md) supersedes all invitation/passkey instructions below. The current app uses open username/password registration followed by face capture.

Updated 21 October 2026. This is the current guide; IMPLEMENTATION.md describes the earlier foundation and NEXT-STAGE.md records an earlier milestone.

## What is implemented

| Requested part | Current implementation | What still needs evidence |
|---|---|---|
| Face matching | Decrypt the browser enrollment, extract a new descriptor, quantize to signed INT16 at scale 4096, compare squared distance, then authorize with a passkey. | The default 0.5 threshold remains provisional until participant calibration. |
| Quantization | INT16 descriptor comparison; reproducible all-UINT8 weight-storage variant; paired study extraction, model-specific calibration, descriptor drift and inference-time reporting. | Real accuracy/latency measurements. Both networks still execute floating-point inference; integer-only neural inference is not implemented. |
| Accounts/database | PostgreSQL records, migrations, invitations, one verified passkey per account, sessions, bindings, challenges, recovery and rate limits. Persistent local launcher included. | Production operations and hosting are outside the local prototype. |
| Authorized enrollment | Operator invitation creates the reserved server identity. WebAuthn registration activates it. A fresh passkey assertion authorizes the exact pending template commitment. | Physical Touch ID/security-key validation by the user. |
| Replay prevention | Expiring server challenges bound to account, operation and session, with atomic consumption. Proof acceptance rechecks current binding, policy and session. | Real-device end-to-end trial; automated replay and concurrency tests pass. |

Additional work now connected: browser recovery/security controls and a private descriptor-comparison proof. **Full zkML (proof of neural inference) is deliberately not implemented.**

## Start the local app

Requirements: Node 22.12+ and Python 3.12+. The existing virtual environment can be reused. On a fresh checkout:

```sh
cd /Users/atharv/projects/privface
python3.12 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
npm --prefix client ci
npm --prefix zk ci --ignore-scripts
npm --prefix tools ci
```

The PostgreSQL package includes platform-specific binaries. Its allowed postinstall script restores packaged symlinks; if your npm policy blocks it, run that package's `scripts/hydrate-symlinks.js` explicitly (on this Mac: `node tools/node_modules/@embedded-postgres/darwin-arm64/scripts/hydrate-symlinks.js`).

```sh
node tools/dev.mjs
```

Open **http://localhost:5173**. The launcher starts persistent PostgreSQL on loopback port 15432, applies migrations, prepares local proving/model assets, starts the API on 8000 and Vite on 5173. The first proof setup can take minutes. Ctrl+C stops services while preserving data. Stop older PrivFace dev servers first if their ports are occupied. For isolated tests, `PRIVFACE_WEB_PORT=5175 PRIVFACE_API_PORT=8002 node tools/dev.mjs` selects other app ports. Browser enrollment storage is origin-specific: changing the web port changes its storage location.

Local state:

- `data/postgres/`: persistent PostgreSQL cluster; never checked into Git.
- `data/local-config.json`: randomly generated database credentials, private file permissions.
- `data/<username>-invitation.txt`: one-time operator invitation, private file, 24-hour lifetime.
- `zk/artifacts/`: generated development proving setup, verifier key and browser assets; ignored by Git.
- Browser IndexedDB: encrypted templates and encrypted commitment openings; these are separate from PostgreSQL.

To issue an invitation while the launcher is running:

```sh
node tools/invite.mjs atharv Atharv
```

On this machine, the initial `atharv` invitation has already been created at `data/atharv-invitation.txt`; account activation still requires your passkey. Read the resulting invitation file locally and paste its value into **Account invitation**. Tokens are not printed in server logs. Existing accounts are never overwritten. A used or expired invitation is not a recovery mechanism. If an unused invitation expires before signup, explicitly run `node tools/invite.mjs atharv Atharv --renew`. It replaces the unused token for the same reserved identity and invalidates old challenges. Active accounts cannot be renewed this way. A renewed token is written to a separate private file; existing files are never overwritten.

For setup without serving the app, use `node tools/dev.mjs --setup-only --check-persistence`. To create a new invitation in the same setup operation, add `--invite username "Display name"`.

## Normal enrollment and login

1. Create the server account using your invitation and a physical passkey.
2. In Register, use the same username, consent, enable the camera and complete the movement prompts.
3. Capture and save the encrypted local enrollment.
4. In Server account, choose **Bind saved face enrollment**, then confirm your passkey again. This binds the current local template to your server identity.
5. To test face-assisted login, sign out, select Log in, enter the username and take a fresh capture. Choose **Compare face & continue with passkey**.
6. The browser compares locally, obtains passkey authorization, constructs a private descriptor proof in a worker, and submits it for server verification. If proof generation/verification fails, this flow attempts to end its newly created session and reports the failure.

Passkey-only sign-in remains available. Server authentication is always based on the passkey. An existing SHA-256 binding needs a fresh **Authorize a new template binding** action to become compatible with the Poseidon proof scheme; there is no silent conversion.

The local template and its key are both browser-held. Encryption protects stored values but cannot protect them from malicious same-origin JavaScript or a compromised browser. Clearing site storage loses both the template and its opening; passkey sign-in/recovery remains separate.

## Recovery and account controls

Open **Recovery and account security** after signing in. Every action requires a fresh passkey assertion and an authenticated session/CSRF token.

- **Generate new recovery code:** displays a random bearer code once. Save it offline. The server stores only its digest. A new code invalidates the previous one; hiding/leaving the page clears the display.
- **Revoke face binding:** invalidates the server binding and pending enrollment/proof challenges. It does not delete the browser template.
- **Sign out all devices:** revokes sessions and outstanding challenges.
- **Disable account:** requires the confirmation checkbox and passkey; prevents further sign-in/recovery.
- **Recover a lost passkey:** while signed out, supply the offline code and create a new passkey. This consumes the code, replaces the old credential, revokes old sessions and removes the server template binding. Rebind afterward and generate another recovery code. Use a replacement authenticator when the previous one is unavailable; this is not an “add a second passkey” feature.

## Collect the real study in the app

Open **http://localhost:5173/study**, or use Calibration study in the navigation. You chose to collect samples using the app; no real participant data has been supplied or invented.

1. Assign anonymous participant codes. Obtain each participant's consent.
2. Assign a participant to **either calibration or held-out test**, never both.
3. Use at least two independent capture sessions per participant, ideally on separate days or under different lighting. Change the session code accordingly.
4. Complete the movement prompts, capture a frame and choose **Add capture to study**. Retake for each independent sample.
5. Export the sensitive dataset before leaving. Re-import it on the next session to append captures. The app keeps descriptors in page memory, not server storage. Images are not exported.
6. Evaluate and export the report after collecting enough samples. A starting pilot of 4 participants per split × 2 sessions × 3 captures = 48 samples exercises the minimum pair requirements. It does not establish population accuracy or a rare-event false-accept rate.

Each capture runs the baseline and experimental weight-storage model on the same aligned crop. Timing excludes model loading and face detection; model order alternates randomly. The report contains independently selected thresholds, held-out FAR/FRR, pair counts, quantization drift, model descriptor drift and mean inference times. Both networks use floating-point inference after weights are loaded. Do not claim full INT8 neural execution or measured speedup without evidence.

The evaluator requires at least 20 genuine cross-session pairs and 20 impostor pairs in each split. It rejects participant leakage and duplicate sample IDs. Pairs sharing participants/captures are correlated; zero observed false accepts does not imply zero risk. Collect more participants for a meaningful study.

Exports contain biometric descriptors despite not containing photographs. Store them privately outside Git. Clear in-page samples and delete downloaded files according to participant consent and your study's retention plan. Imports should only contain consented samples.

## Install a reviewed matching policy

Reports do not change the running threshold automatically. Review the held-out results, collection conditions and sample sufficiency first. Then, from `client/`:

```sh
node --experimental-strip-types scripts/apply-policy.mjs \
  /absolute/private/path/privface-consented-samples.json \
  /absolute/private/path/privface-calibration-report.json \
  --apply-reviewed
```

This recomputes the baseline report, requires an exact match to the reviewed report, rejects held-out FAR above the requested target and atomically updates `src/match-policy.json`. It saves the previous policy locally. It never installs the experimental network or changes enrolled model identities. Rebuild the client after promotion. New server proof challenges read the current policy; proofs issued for a different limit are rejected. Do not adjust the threshold based on held-out errors and then reuse those same subjects as an untouched test set.

## What the descriptor proof actually establishes

The circuit accepts two private 128-value descriptors and a private 248-bit blinding value. It verifies range constraints, nonzero vectors, a Poseidon commitment to the enrollment and the squared-distance limit. Public values bind the proof to the account, server nonce, enrollment root, threshold and model tag. The server nonce has 248 bits in the circuit and is derived from a fresh 256-bit challenge value.

The server returns proof options only to an authenticated passkey session. `/api/proof/verify` validates the real Groth16 proof, checks public inputs against the stored challenge, then atomically consumes it after rechecking expiry, session revocation, account activity, binding version and current policy. A per-session `descriptor_proof` marker is valid only for the current binding/setup/policy. Proofs never create authentication sessions.

**A malicious client could supply its enrolled vector as the probe. This proves descriptor consistency, not that a camera captured a live person or that a neural network produced the probe.** Full zkML and trusted capture provenance are different, unfinished problems.

The generated setup is single-party and for local development. The server rejects this development setup on a non-local origin. It verifies artifact digests/source identity at startup; the browser checks proving-asset digests. This is not a production ceremony or an independent cryptographic audit. The worker loads snarkjs locally; GPL-3.0 license text is included among its prepared assets, and Poseidon constants are derived from GPL-3.0 circomlibjs. Review those licenses before distributing a derivative product.

## Tests and evidence

Reproduce:

```sh
npm --prefix client test
npm --prefix client run build
node tools/test-postgres.mjs
npm --prefix zk test
```

`tools/test-postgres.mjs` creates a separate disposable PostgreSQL cluster on port 15433, runs all migrations, checks schema drift, runs API tests and removes that test cluster. It never uses `data/local-config.json` or the application's accounts. API pytest also supports a disposable `TEST_DATABASE_URL`; never point it at application data because fixtures drop tables.

Browser tests: `client/tests/passkey-smoke.mjs` needs a fresh disposable invitation, running app, Playwright module and Chrome. See IMPLEMENTATION.md for environment variables. It uses a virtual authenticator and synthetic descriptors, exercises registration, binding, local worker proving, server acceptance, replay rejection, login, replacement-passkey recovery, rebinding, revocation and the consent-gated study screen. It asserts descriptor/opening fields are absent from API request bodies. This is not a physical camera or real biometric accuracy test.

Validation recorded for this update:

- 39 client tests pass, including browser/reference Poseidon equality and paired-study model separation.
- 33 API tests pass with actual WebAuthn signatures and real Groth16 verification on both SQLite and PostgreSQL.
- PostgreSQL migrations/schema consistency and persistent stop/restart checks pass.
- TypeScript and the production build pass. Existing face-api.js bundle-size and browser `fs` externalization warnings remain.
- Headless Chrome integration passes using a virtual replacement authenticator and synthetic descriptors. `client/tests/study-smoke.mjs` additionally checks paired dataset import/report export, unchanged live policy, blank-image rejection, local clearing, absence of API POSTs, and mobile overflow (same Playwright/Chrome environment variables; no invitation needed).
- Dependency audit on the pinned ZK toolchain reports 15 low-severity findings, with no high/moderate findings after scoped compatible `ws`/`underscore` overrides. Remaining findings are in circomlibjs's transitive elliptic/ethers tooling; those wallet/signature primitives are not used by this application. Do not equate this with a clean production security audit.

## What remains before making research or production claims

- Collect the consented participant study, review results and install a measured baseline policy.
- Complete physical webcam, Touch ID/security-key, supported-browser and device trials. Record denied permissions, low light, no/multiple faces, a different participant and recovery on a replacement authenticator.
- Evaluate photo/video presentation attacks. The current movement check is a heuristic, not certified spoof protection.
- Decide whether the synopsis requires actual integer-only neural inference. That runtime/model work remains; UINT8 weight storage and INT16 matching do not fulfill it by themselves.
- Full zkML is the next distinct proof stage and was not implemented here.
- Before public deployment: a reviewed production setup, HTTPS/CSP, independent application/circuit review, backup/restore, retention operations, monitoring, scaling and additional-passkey/account-administration workflows.

No real biometric results, calibrated threshold, physical passkey pass, or production-readiness claim is made in this update.
