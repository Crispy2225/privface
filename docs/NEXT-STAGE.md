# Next-stage progress

> Archived historical implementation record. Descriptions of passkeys, missing features and old commands below refer to that earlier milestone and do not describe the current app. Use [PASSWORD-REGISTRATION.md](PASSWORD-REGISTRATION.md) for current operation, [PRE-ZKML.md](PRE-ZKML.md) for study/proof scope, and [M1-FACE-FIRST-AUTH.md](M1-FACE-FIRST-AUTH.md) for the face-first target. Do not use this archived file as a setup or current-status guide.

## Added

- Fresh-passkey-authorized security endpoints: `/api/security/options` accepts `action` of `recovery-code`, `revoke-binding`, `logout-all`, or `disable-account`. `/api/security/verify` accepts the normal challenge/credential response, authenticated cookie and CSRF token. Recovery codes are returned once; only their digest is stored. Generating another replaces the old code.
- `/api/recovery/options` accepts a recovery code and generates a new-passkey registration ceremony. `/api/recovery/verify` validates it, atomically consumes the recovery code, replaces the old passkey, deletes previous bindings/challenges, and revokes previous sessions. Disabled accounts cannot be recovered this way. These are API features; account-management UI remains to be connected.
- A migration adds `recovery_codes`. Run `server/.venv/bin/alembic -c server/alembic.ini upgrade head` with DATABASE_URL exported.
- Retention cleanup: `PYTHONPATH=server server/.venv/bin/python -m app.maintenance --retention-days 7`. It removes expired records older than the retention window, preserving active accounts, credentials, bindings, and referenced sessions. No recurring job has been installed.
- An experimental Circom/Groth16 circuit under `zk/`. It range-checks two private 128-value INT16 descriptors, verifies a blinded Poseidon commitment to the enrolled vector, constrains squared distance against the public limit, and binds account/model/nonce through a public context hash.

## Reproduce the proof experiment

```
npm --prefix zk ci
npm --prefix zk run setup
npm --prefix zk test
```

Setup generates local artifacts under ignored `zk/artifacts/`. It refuses to overwrite an existing manifest. The setup is a single-party development ceremony, not an independently audited production ceremony. `docs/zk-experiment.json` records measured synthetic proving/verification results when tests succeed. Input descriptors remain private to the prover. Modified public context values and a nonmatching witness are tested for rejection.

**This is a descriptor-relation proof, not proof of neural inference or live camera provenance.** A malicious client can supply the enrolled vector as its probe. The new Poseidon commitment is incompatible with existing SHA-256 enrollment commitments. No server endpoint currently accepts these proofs, and existing authentication remains passkey-based. Do not replace that authentication with this experiment.

## Still outstanding

Persistent application database provisioning; browser recovery/revocation controls; proof integration with a separately versioned passkey-authorized commitment, server nonce consumption and verifier; full zkML/integer neural inference; participant threshold calibration; physical passkey/camera and spoof trials; production hosting. Real biometric measurements require consented participant data. Previous setup and evaluation instructions remain in IMPLEMENTATION.md.
