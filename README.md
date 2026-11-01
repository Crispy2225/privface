# PrivFace — password accounts and local face verification

Read [docs/PASSWORD-REGISTRATION.md](docs/PASSWORD-REGISTRATION.md) for the current registration, face setup, login, recovery, and migration instructions.

Start locally with `node tools/dev.mjs`, then open http://localhost:5173. Select Register, choose a username and password, and continue to face capture. Invitations and passkeys are no longer required or used.

Passwords authorize server sessions. Face images and encrypted templates stay in the browser. Optional descriptor-comparison proofs supplement password login; they do not prove neural inference or live capture. Participant calibration and integer-only neural inference remain unfinished.

The [study page](http://localhost:5173/study) still supports consented collection and local reports. See [docs/PRE-ZKML.md](docs/PRE-ZKML.md) for study/proof details; its older authentication instructions are superseded by the password guide.

Tests: `npm --prefix client test`, `npm --prefix client run build`, and `node tools/test-postgres.mjs`.
