# PrivFace study and descriptor proof guide

Scope note (M2/M3): this guide describes the existing password/face-api/descriptor-proof path. The separate full-inference research implementation is documented in [M2](M2-MODEL-FEASIBILITY.md) and [M3](M3-ZKML.md); it is not enabled for normal login.

Current implementation reviewed 1 November 2026. Use [PASSWORD-REGISTRATION.md](PASSWORD-REGISTRATION.md) to run the current password-first account flow. The future face-first login and password fallback are specified in [M1-FACE-FIRST-AUTH.md](M1-FACE-FIRST-AUTH.md). [M1-BASELINE.md](M1-BASELINE.md) records the checks rerun for this milestone.

## Current implementation

| Area | Implemented | Remaining |
| --- | --- | --- |
| Accounts | Username/password signup/login, recovery, revocation, sessions, PostgreSQL migrations and local launcher | Primary face login and its unauthenticated attempt/session protocol |
| Enrollment | Encrypted browser templates and account-bound commitments authorized by the password session | Full inference-backed enrollment and fresh password confirmation for replacement |
| Matching | Local 128-dimensional descriptors and INT16 comparison at scale 4096 | Real participant calibration; current threshold 0.5 is provisional |
| Quantization | Quantized weight storage, all-UINT8 storage experiment, INT16 descriptors | Proof-compatible quantized inference and measured accuracy/performance |
| Proof | Browser Groth16 descriptor-comparison proof and remote verification | Proof of neural inference; proof-authorized login |
| Replay protection | Expiring challenges, atomic consumption and session/binding/policy rechecks | Equivalent guarantees for the new signed-out face-login protocol |

## Local setup

Requirements recorded by the project: Node 22.12+ and Python 3.12+. On a fresh checkout:

```sh
python3.12 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
npm --prefix client ci
npm --prefix zk ci --ignore-scripts
npm --prefix tools ci
node tools/dev.mjs
```

Open http://localhost:5173. The launcher starts persistent PostgreSQL on loopback port 15432, runs migrations, prepares model/proof assets and starts the API and client. Initial proving setup can take minutes. Stop older dev servers if ports conflict. Registration no longer uses invitations or passkeys.

The PostgreSQL package includes platform-specific binaries. If installation policy blocks its required postinstall hydration, follow the installed package's platform-specific instructions. Do not use archived invitation CLI commands.

Local state includes ignored `data/postgres/`, private database configuration in `data/local-config.json`, development proving artifacts in `zk/artifacts/`, and browser IndexedDB enrollment/opening records. Do not publish private state or point test fixtures at the application database. Browser storage belongs to its origin: changing the web port changes access to that enrollment.

## Collect the real study in the app

Open **http://localhost:5173/study**, or use Calibration study in the navigation. Collect consented real samples before treating evaluation output as biometric evidence.

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

## What the current descriptor proof establishes

The circuit accepts two private 128-value descriptors and a private 248-bit blinding value. It verifies ranges, nonzero vectors, a Poseidon enrollment commitment and the squared-distance limit. Public values bind the relation to account, nonce, enrollment root, threshold and model tag. The circuit nonce uses 248 bits of a fresh 256-bit server challenge.

`/api/proof/options` requires an authenticated password session. `/api/proof/verify` checks the real Groth16 proof and exact public inputs, then atomically consumes the challenge after rechecking expiry, account/session activity, binding version, setup and threshold. A `descriptor_proof` session marker supplements password authentication. It does not create a session.

A modified client can supply the enrolled descriptor as the probe. This proves descriptor consistency, not neural inference or live capture. Full zkML must connect the probe to the approved model output; even that does not establish that the input was freshly captured rather than an old image. The M1 specification defines the resulting trust boundary and future acceptance cases.

The generated setup is single-party and restricted to local development origins. Server and browser artifact checks detect mismatched files; they are not an independent circuit audit or production ceremony. Review bundled snarkjs/circomlibjs licensing before redistribution.

## Reproduce verification

```sh
npm --prefix client test
npm --prefix client run build
node tools/test-postgres.mjs
npm --prefix zk test
```

The PostgreSQL script creates a separate disposable cluster, applies migrations, checks schema consistency and runs API tests. It never uses application database credentials. API fixtures create/drop tables, so a supplied `TEST_DATABASE_URL` must always identify a disposable database. The standalone `zk test` command rewrites `docs/zk-experiment.json` with synthetic descriptor-proof results; those are not full zkML or biometric benchmarks.

`client/tests/password-smoke.mjs` covers the current password signup/login, local binding, browser proof, recovery and disablement using a disposable account and synthetic descriptors. It requires a running test app, Playwright and a browser. `client/tests/study-smoke.mjs` checks study import/export, policy isolation, clearing and layout. Neither establishes webcam accuracy or spoof resistance. Historical passkey smoke scripts are no longer the current workflow.

An explicit retention cleanup command exists:

```sh
PYTHONPATH=server server/.venv/bin/python -m app.maintenance --retention-days 7
```

It removes old expired records and preserves active account/binding data. A recurring cleanup schedule, backup/restore and production monitoring remain separate operational work.

## Remaining research work

Follow M2-M8 in the M1 specification: model/prover feasibility, actual zkML, primary face login with password fallback, final-model calibration, security/capture trials, repeated benchmarks and reproducible delivery. The existing quantization smoke test uses a synthetic zero tensor; existing proof timing measures descriptor comparison. Neither supports real biometric accuracy, live-presence or full-inference performance claims.
