# M1 verified implementation baseline

Reviewed 1 November 2026 against source commit `5cdf6c8443eef5c08ccde1bb08c29aa14ef12d8f`. The working tree was clean before M1. M1 changes documentation only; the target protocol is in [M1-FACE-FIRST-AUTH.md](M1-FACE-FIRST-AUTH.md).

## Current behavior and evidence

| Area | Current behavior | Source |
| --- | --- | --- |
| Login | Password verification issues sessions; UI requests password before optional face verification | `server/app/main.py`, `client/src/App.tsx`, `client/src/account-api.ts` |
| Enrollment | Local AES-GCM template, encrypted opening, password-session-authorized server commitment | `client/src/template-crypto.ts`, `enrollment-store.ts`, `proof-client.ts`, `server/app/main.py` |
| Binding lifecycle | One server binding per account; replacement increments version, clears descriptor-proof markers and pending proof challenges | `server/app/database.py`, `server/app/main.py` |
| Recognition | face-api.js CPU inference; 128-value descriptors; study compares baseline and experimental weight storage | `client/src/face-embedding.ts` |
| Matching | INT16 scale 4096, provisional threshold 0.5, `calibrated: false` | `client/src/face-match.ts`, `match-policy.json` |
| Proof | Supplied private descriptors, range/nonzero checks, Poseidon commitment, distance and public context | `zk/circuits/face_match.circom` |
| Verification | Real Groth16; existing authenticated password session required; no proof-created session | `server/app/proof_service.py`, `server/app/main.py` |
| Recovery | One-time recovery code resets password, revokes sessions/challenges and removes binding | `server/app/main.py`, `client/src/AccountAccess.tsx` |
| Capture | Blink/head-movement heuristic and camera lifecycle checks, without trusted camera attestation | `client/src/liveness.ts`, `useFaceValidation.ts`, `CameraCapture.tsx` |
| Operations | Migration-backed PostgreSQL local launcher and explicit retention cleanup | `tools/dev.mjs`, `server/migrations/`, `server/app/maintenance.py` |

## Checks rerun for M1

| Check | Result | Scope |
| --- | --- | --- |
| Client unit tests | 39 passed, zero failures/skips | Camera lifecycle, movement heuristics, storage/crypto, matching/calibration, Poseidon and paired-study behavior |
| Backend and proof tests | 26 passed; one dependency deprecation warning | Temporary SQLite databases; actual Groth16 proofs with synthetic descriptors, password/account/recovery controls, stale context and concurrent replay |
| TypeScript | Passed | `tsc --noEmit` |
| Production bundle | Passed | Vite build with existing local assets and `--configLoader runner`; output under `/private/tmp/privface-m1-build-20261101` |

The Vite build reports face-api.js browser `fs` externalization and a chunk over 500 kB. These are existing warnings. The backend reports a Starlette TestClient/httpx deprecation warning. No dependency changes were made in M1.

These checks do not establish face-first login, zkML inference, real-camera accuracy, liveness security, or a calibrated threshold. PostgreSQL/migration integration, browser smoke tests, a fresh dependency installation and physical-camera trials were not rerun for M1. Earlier verification claims in historical documents are not new M1 evidence.

## Reproduce the baseline

From the repository root with installed dependencies and existing proof artifacts:

```sh
npm --prefix client test
# Remove any inherited database URL so fixtures use their own temporary SQLite files.
env -u TEST_DATABASE_URL PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server \
  NODE_BINARY="$(command -v node)" \
  server/.venv/bin/python -m pytest server/tests -q -p no:cacheprovider
```

From `client/`:

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build --configLoader runner \
  --outDir /private/tmp/privface-m1-build-20261101
```

The M1 run used Node v24.22.1 and Python 3.12.14. It used the bundled Node executable at `/Users/atharv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` and `server/.venv/bin/python`. TypeScript emitted no files; pytest bytecode/cache writing was disabled. The build used already prepared model/runtime assets, bypassing the npm prebuild preparation hooks. Use the normal `npm --prefix client run build` command for a full preparation/build cycle when developing.

For subsequent changes to database/schema/session logic, also run `node tools/test-postgres.mjs` against its disposable cluster and the password/face browser scenarios in an isolated test environment. Do not use the application database for test fixtures.

## Completion record

- Face-first login and password fallback specified as independent normal-access methods.
- Registration, browser enrollment, replacement, recovery and session invalidation rules defined.
- Private/public proof inputs and the inference-to-matching relation defined; numeric/circuit details assigned to M2/M3.
- Capture freshness distinguished from challenge freshness; trusted capture is not claimed.
- Proposed signed-out attempt API, browser binding, resource limits and atomic session issuance defined.
- Synopsis requirements mapped to M2-M8 and future acceptance cases recorded.
- README and current guides reconciled; old implementation records explicitly archived.
- Existing implementation baseline rerun and limitations recorded.

Next milestone: M2, a measured quantized-model and proving feasibility experiment. No new face-login endpoint, schema migration, production deployment or account-data change is part of M1.
