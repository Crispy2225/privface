# Enrollment and account binding

Scope note (M2/M3): this guide describes the existing password/face-api/descriptor-proof path. The separate full-inference research implementation is documented in [M2](M2-MODEL-FEASIBILITY.md) and [M3](M3-ZKML.md); it is not enabled for normal login.

Current implementation reviewed 1 November 2026. The future face-first protocol is in [M1-FACE-FIRST-AUTH.md](M1-FACE-FIRST-AUTH.md); the running account flow is in [PASSWORD-REGISTRATION.md](PASSWORD-REGISTRATION.md).

## Current local storage

Templates are AES-256-GCM encrypted in IndexedDB with non-extractable keys stored in the same browser. Commitment openings are encrypted locally. Images, descriptors, keys and openings are not uploaded to the API. Local encryption does not protect an unlocked template from malicious same-origin code.

Enrollment storage is browser-profile and origin specific. Clearing it loses the template and its opening. Local deletion does not remove the server commitment; server binding revocation is a separate account-security action.

## Current server authorization

Username/password registration or login creates a session. `/api/enrollment/options` requires that session and its CSRF token, and stores the exact pending commitment with a single-use challenge. `/api/enrollment/verify` consumes the challenge and rechecks the initiating account/session before updating the binding version. Current binding does not require a fresh password confirmation; M4 will add that protection for existing-account enrollment and replacement.

The code accepts the legacy `sha256-blinded-v1` commitment and, when the proof service is enabled, `poseidon-int16-v1`. The Poseidon commitment supports the current Groth16 descriptor-comparison circuit. The running model is `face-api.js@0.22.2/faceRecognitionNet/128-v1`, with `int16-s4096-v1` descriptor quantization. The database has one active binding per account.

Changing a binding clears supplementary descriptor-proof markers and pending proof challenges. The current proof does not authorize login and does not establish that a model generated its descriptors. Existing account sessions are password sessions.

## Target changes owned by M3 and M4

The target requires a versioned enrollment inference proof and password-authorized binding, direct session issuance from a full face-login proof, and explicit password fallback. Replacing enrollment will require fresh password confirmation, invalidate old face-login attempts/sessions, and retain password access. New model or incompatible commitment formats require explicit re-enrollment rather than silently reinterpreting templates.

A new browser must use password fallback and enroll locally. Under the initial single-binding design this replaces the previous browser's active binding; warn the user before replacement. Simultaneous multi-device enrollment and biometric synchronization are outside this initial scope.
