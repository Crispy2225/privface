# PrivFace

PrivFace is being developed for **face-first login with password fallback**. A successful face proof will create a server session directly; password login will remain available when face verification fails or cannot run.

**Current application:** passwords create sessions, followed by optional local face verification and a private descriptor-comparison proof. The normal face-api recognition path still executes floating-point inference and uses an uncalibrated threshold.

**M2/M3 research path:** a trained compact integer neural network, full inference/enrollment/matching circuit, real Groth16 proofs, browser worker and server verifier adapter are implemented separately. Open `/zkml.html` after preparing its artifacts. The small research model has poor held-out recognition results and is **not suitable for authentication release**. It is not enabled in normal login. Primary face login is M4; model quality and real-camera calibration remain unresolved.

## Documentation

- [M1 face-first authentication specification](docs/M1-FACE-FIRST-AUTH.md): target protocol, enrollment/fallback rules, trust boundaries, implementation stages and acceptance cases.
- [M1 verified baseline](docs/M1-BASELINE.md): current source revision, checks and limitations.
- [M2 model and feasibility](docs/M2-MODEL-FEASIBILITY.md): trained model, integer arithmetic, data split, accuracy limitations and measured proving feasibility.
- [M3 full inference proofs](docs/M3-ZKML.md): proof statement, browser implementation, server adapter, adversarial tests and reproducible setup.
- [Viva guide](docs/M2-M3-VIVA.md): stage-by-stage explanation, equations, demo steps and likely questions.
- [Current registration and login](docs/PASSWORD-REGISTRATION.md): instructions for the running app, recovery and account controls.
- [Study and descriptor proof guide](docs/PRE-ZKML.md): collection, calibration and the scope of the existing proof.
- [Enrollment binding](docs/enrollment-binding.md): local storage and current server binding behavior.

M1 is complete. M2/M3 now have a reproducible research implementation and measured full-model browser proofs; biometric suitability is not established. M4 integrates primary face login only after an acceptable model is selected. M5-M8 cover final-model calibration, security testing, benchmarking and delivery. Historical passkey instructions in IMPLEMENTATION.md and NEXT-STAGE.md are archived context, not setup instructions.

## Run locally

Run `node tools/dev.mjs`, then open http://localhost:5173. The current app asks for a username/password to register or log in. See the current registration guide above. Templates stay in the browser profile/origin where they were enrolled.

## Verify

```sh
npm --prefix client test
npm --prefix client run build
node tools/test-postgres.mjs
```

The PostgreSQL command creates a disposable database. Never point API test fixtures at application data. See the baseline for isolated SQLite verification and the scope of checks rerun for M1.
