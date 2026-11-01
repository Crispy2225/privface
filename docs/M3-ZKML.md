# M3 — Full integer neural-inference proofs

Reviewed: 1 November 2026.

## Status

**Implemented and verified for the M2 research model:** complete neural inference, enrollment and matching relations, development proof artifacts, browser-worker generation, context-bound verification, and a reusable Python server verifier adapter.

This is a real inference proof, not the legacy supplied-descriptor comparison. It proves a small trained network, not the original face-api model. The small model's accuracy is inadequate for normal authentication (see [M2](M2-MODEL-FEASIBILITY.md)). M4 session issuance, server challenge storage and persistent enrollment are not implemented by this stage. The default app still authenticates with passwords.

## Data flow

```text
Private aligned crop (1024 bytes)
    -> constrained centering
    -> constrained integer Dense / ReLU / Dense
    -> private 16-coordinate embedding
    -> constrained commitment or distance relation
    -> Groth16 proof + public context
    -> pinned verifier
```

The probe embedding cannot be supplied as a free witness. It is computed within `PrivateInference`. All weights are compile-time constants generated from the pinned model. A user cannot choose an alternate network through the proof request.

## Public and private inputs

| Private | Public / verifier configuration |
| --- | --- |
| 1,024 byte pixels | Account field (128 bits) |
| Enrolled descriptor, encoded as coordinate +32768 | Nonzero challenge nonce (248 bits) |
| Nonzero 248-bit random commitment opening | Enrollment commitment |
| Constrained intermediate activations | Nonzero binding version (32 bits) |
| | Operation: 1=enrollment, 2=matching |
| | Nonzero squared-distance limit (32 bits) |
| | Model and policy identity fields |
| | Output context hash |
| | Pinned verification key/setup ID outside the circuit |

Signals have fixed order: `[contextTag, account, nonce, enrollmentRoot, bindingVersion, operation, limit, modelTag, policyTag]`. The verifier rejects noncanonical decimal strings, wrong lengths, out-of-field values and mismatches against expected context. No image, embedding or opening is required by the verifier adapter.

## Relations

The domain separator is `2026110101`. Commitment construction is Poseidon over domain, account, model identity and secret opening, followed by two eight-coordinate descriptor blocks. Blinding protects against straightforward enumeration of small candidate sets. Do not reuse or disclose openings.

**Enrollment:** prove that the committed descriptor equals the exact output of the approved model on the private crop. A correctly formed commitment to an arbitrary supplied descriptor is insufficient.

**Matching:** prove that the enrolled descriptor opens the authorized commitment and that squared Euclidean distance from the inferred probe embedding is at most the approved limit.

One circuit supports both relations; `(operation-1)*(operation-2)=0` restricts the operation. Enrollment additionally enforces coordinate equality. The operation is included in the public context hash, and the server adapter must compare it with the trusted expected operation. An enrollment proof is not interchangeable with a matching proof.

Every context field, including the nonce and policy identity, feeds the Poseidon context output. The verifier also checks the exact expected public signals. Correct nonce binding is not replay prevention by itself: the future M4 server must issue, expire and atomically consume challenges. The stateless M3 verifier intentionally has no replay database or session authority.

## Artifacts and provenance

`zk/scripts/setup-ml.mjs`:

1. Validates the model format, dimensions and conservative numeric bounds.
2. Generates `zk/generated/model.circom` with frozen public weights and model identity.
3. Compiles R1CS, WASM and symbols with Circom inspection enabled.
4. Creates or verifies development powers-of-tau, then performs a fresh Groth16 phase-2 contribution for this circuit.
5. Verifies the zkey against R1CS and powers-of-tau.
6. Exports the verification key and same-origin browser assets.
7. Records SHA-256 digests for model, policy, circuit source, generated constants, R1CS, keys, runtime and browser worker.

The measured run reused the existing development `final.ptau`, verified it, and generated a new circuit-specific zkey. `developmentOnly: true` is explicit. A single-party development ceremony does not supply production trusted-setup assurance. No claim of audit or production security is made.

Browser assets are in `client/public/zkml/`. Large generated assets and `zk/artifacts-ml/` are ignored by git. The model, policy, source, training code and measurement reports are tracked. Setup refuses to overwrite an existing manifest. Model/circuit changes require explicit preservation and replacement of old artifacts. Browser-glue-only updates can use `prepare:ml-browser`, which refuses changed model/circuit/proving assets.

## Browser integration

Visit `/zkml.html` through the local development server. This separate lab performs genuine enrollment and matching proofs using an actual worker. It provides upload previews, progress, cancellation, timeout and session clearing. No account login is granted by this page. No camera permission is requested by the lab; existing app camera behavior is unchanged.

`client.mjs` validates model/policy/setup consistency and fetches the worker bytes with SHA-256 verification. The worker verifies the hashes of snarkjs, WASM, zkey and verification key before use. It runs locally with `singleThread:true`; no remote proving service receives the witness. A 90-second timeout or abort terminates the worker. The page also cancels when hidden or left. The initial origin/server is trusted to distribute the correct application and manifest; hashes do not defend against a compromised same-origin server or malicious application code.

The research page holds template and opening only in memory. Reloading loses enrollment. It does not downgrade the main application's encrypted IndexedDB storage. Model incompatibility produces an explicit re-enrollment error.

## Server adapter

`server/app/zkml_service.py` provides `ZkMLVerifier.verify`. It calls `zk/scripts/verify-ml.mjs`, which verifies artifact hashes, model/policy identities, setup ID, expected context and the Groth16 proof.

It bounds request data at 32 KiB, subprocess duration at 20 seconds and concurrent verification at two per adapter instance. M4 must keep a long-lived adapter instance and provide application-wide limits as appropriate. Errors fail closed. Private witnesses never appear in subprocess arguments or the verifier payload.

**Caller contract:** `expected` must come from trusted server-side challenge state. Passing the requester's expected values would defeat account/nonce/policy authorization. The adapter is not an HTTP authentication endpoint. It does not authorize enrollment, issue sessions, prove freshness, consume challenges or reject replay on its own. These are M4 responsibilities.

## Tests and evidence

`npm --prefix zk run test:ml` checks:

- Python/JavaScript/Circom agreement on black, white, midpoint, ramp and checker grids.
- Real enrollment and matching proofs; the matching input is slightly different from enrollment.
- Rejection when any of the nine public signals is changed.
- Trusted expected-context mismatch and noncanonical field rejection.
- Invalid pixel ranges, model identity, operation, blinding, nonce and account bounds.
- Arbitrary descriptors, including a new internally consistent commitment to a false enrollment output.
- A nonmatching crop paired with the old enrolled descriptor.
- Direct corruption of an intermediate witness wire, bypassing the honest witness calculator; the R1CS check fails.
- Valid server-adapter verification and rejection of malformed proofs, retired setup and altered thresholds.

`client/tests/zkml-smoke.mjs` uses real headless Chromium and WASM, not a mocked prover. It checks enrollment/matching, rejection, cancellation, timeout, stale templates, corrupted model assets, visible upload controls, clearing, mobile viewport overflow, and GET-only same-origin network traffic. Test inputs are synthetic grayscale grids; they demonstrate computation correctness, not face accuracy or liveness.

Backend regression tests include the original password/descriptor-proof suite and the new full-inference verifier adapter. The reviewed run passed 28 backend tests and 39 existing client tests. TypeScript/build results are recorded in the completion record. PostgreSQL, physical camera, real phone/browser diversity and a clean network dependency installation are not claimed verified here.

## Reproduce setup and verification

From the repository root, with Node ≥22.12 and Python available:

```sh
npm --prefix zk install
npm --prefix client install

# Committed model already exists. This command creates a development setup.
npm --prefix zk run setup:ml

# Or reuse existing DEVELOPMENT powers, after verification:
# ZKML_PTAU="$PWD/zk/artifacts/final.ptau" npm --prefix zk run setup:ml

npm --prefix zk run test:ml
env -u TEST_DATABASE_URL PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server \
  NODE_BINARY="$(command -v node)" \
  server/.venv/bin/python -m pytest server/tests -q -p no:cacheprovider

# The browser test needs Playwright and a Chromium installation.
# PLAYWRIGHT_MODULE may point to an installed playwright/index.mjs.
# CHROME_PATH may point to the Chrome executable.
npm --prefix client run test:zkml-browser
npm --prefix client test
npm --prefix client run build
```

The browser test starts and stops its own temporary localhost server. For manual use, run `node tools/dev.mjs` and open `http://localhost:5173/zkml.html`. Normal npm build copies already-generated proving assets; it does not run a trusted setup. A clean checkout must run `setup:ml` explicitly to enable the lab.

If `test_zkml.py` skips because artifacts are absent, that is not proof verification evidence. Run `test:ml` first. Python reference tests require only the standard library; NumPy is needed only for training. For the original legacy backend suite, keep the existing descriptor artifacts available or follow its setup guide.

## Remaining work

The proving engineering works for this research model. A useful authentication model still needs better recognition performance and renewed quantization/proving measurements. M4 then connects proofs to trusted server challenges, authorized encrypted enrollment and actual face-created sessions. M5–M8 cover final calibration, security/capture evaluation, repeated device benchmarks and reproducible delivery.

See [the viva guide](M2-M3-VIVA.md) for how to present this distinction without overstating the result.
