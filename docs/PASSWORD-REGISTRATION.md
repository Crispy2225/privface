# Username/password registration and face setup

Scope note (M2/M3): this guide describes the existing password/face-api/descriptor-proof path. The separate full-inference research implementation is documented in [M2](M2-MODEL-FEASIBILITY.md) and [M3](M3-ZKML.md); it is not enabled for normal login.

Runtime guide for the password-first implementation introduced 21 October 2026. Reviewed for M1 on 1 November 2026. This replaces the invitation/passkey flow in earlier documentation.

The agreed target is now **face-first login with password fallback**, specified in [M1-FACE-FIRST-AUTH.md](M1-FACE-FIRST-AUTH.md). That target is not implemented by this documentation milestone; the steps below describe the running app. See [M1-BASELINE.md](M1-BASELINE.md) for checks rerun on the current source.

## Start and register atharv

From `/Users/atharv/projects/privface`, run `node tools/dev.mjs`, then open http://localhost:5173.

1. Choose **Register**.
2. Enter username **atharv**, choose a password of **12–128 characters**, and confirm it.
3. Check the local face-enrollment consent box.
4. Click **Create account & capture face**. The server account is created and you are signed in.
5. Enable the camera, complete the movement prompts, and capture your face.
6. Check the save-template consent box and choose **Save face & finish registration**.
7. The browser saves the encrypted template and automatically links its commitment to your account. No invitation, Touch ID, security key, or separate binding approval is required.

The account exists after step 4. If camera access fails, it remains available through password login; you can return to **Set up face** later. If saving succeeds but linking fails, use **Account security → Link or refresh saved face enrollment** to retry without overwriting the saved template. Existing local templates remain readable.

## Login and optional face verification

Enter your username and password and click **Log in**. A valid password creates the server session. On the signed-in screen, you may capture a fresh photo and choose **Verify my face**. It compares against the local enrollment and, when enabled, obtains server verification of a private descriptor-comparison proof. A failed optional face check does not cancel a valid password session.

Face verification requires the browser profile/origin where you saved the template. Password login can work from another browser; that browser requires its own face enrollment. The proof establishes descriptor consistency, not live-camera provenance or neural inference. This remains a prototype with a provisional biometric threshold.

## Password storage and account controls

Passwords are hashed using a unique 16-byte salt and scrypt (`N=32768, r=8, p=3`, 32-byte output). The database stores the versioned hash, never the plaintext password. Comparison uses constant-time digest comparison. Password hashing is limited to two concurrent jobs; login/security/reset attempts are rate-limited per account in addition to the shared request limits. Validation errors do not echo submitted passwords.

Cookies remain HTTP-only and SameSite Strict, with session expiry, origin checks, CSRF checks, and atomic single-use challenges. HTTPS and secure cookies remain required for non-local hosting; localhost is only a development exception. Passwords travel to the server over the connection, so do not expose the HTTP development server publicly.

The enrollment binding uses the authenticated password session and its CSRF token. Its exact pending commitment is bound to the account, session, and single-use challenge. It does not require you to type the password again immediately after signup. Sensitive security actions do require the current password:

- Generate a one-time offline recovery code.
- Remove the server face binding.
- Sign out all devices.
- Disable the account (with an additional explicit checkbox).

**Forgot your password?** accepts a saved recovery code and a new password. Resetting consumes the code, revokes previous sessions and challenges, and removes the server face binding; link your local template again afterward and generate a new recovery code.

## Existing data and migration

The migration adds nullable password hashes, permits enrollment bindings without WebAuthn credentials, and revokes old sessions/challenges. It preserves accounts, local enrollments, and historical invitation/credential records. WebAuthn registration/authentication routes and the browser passkey code are removed; historical credential rows no longer authenticate users.

Unused invitation reservations with no credentials or password can register openly with the same username. This allows the existing unused `atharv` reservation to become a normal password account. An already activated account, disabled account, or account with old credentials cannot be taken over through signup.

For an existing activated account that has no password/recovery code, the local operator can issue a private recovery code while the database is running:

```sh
node tools/recover-account.mjs USERNAME
```

The command requires local database access and writes a private file under ignored `data/`; it does not print the code or expose a public reset endpoint. The owner uses that code in **Forgot your password?** to choose their own password. Operator issuance replaces any previous recovery code. Never send account recovery codes to an unverified person.

`tools/invite.mjs` and `server/app/local_invite.py` were removed. The server no longer needs `RP_ID` or the WebAuthn package. Do not use the old invitation CLI instructions. No password has been chosen or stored on behalf of atharv.

## Verification

Historical verification recorded for the 21 October password change (not all rerun for M1): 39 client tests, 26 API/proof tests on SQLite and PostgreSQL, PostgreSQL migrations/schema checks, the password browser flow, and a successful production build. The running registration page was also checked for removal of invitation/passkey controls and mobile horizontal overflow.

- Password/API suite checks signup without invitation, salted hashing, duplicate protection, legacy-account protection/recovery, wrong passwords, session/challenge expiry, CSRF, cross-account/session bindings, replay, concurrent login, recovery, disablement, and rate limits.
- Existing real Groth16 tests now authenticate through passwords and continue checking altered public inputs, replay, and stale binding/policy/session contexts.
- `client/tests/password-smoke.mjs` exercises registration → capture screen, synthetic local enrollment/binding, real browser proof, incorrect/correct password login, recovery, and disablement. It deliberately makes WebAuthn browser APIs throw, so unexpected passkey prompts fail the test.
- Existing study and client unit checks remain applicable. Real camera/participant accuracy still needs your testing; synthetic browser checks do not establish biometric accuracy.

```sh
npm --prefix client test
npm --prefix client run build
node tools/test-postgres.mjs
```

The PostgreSQL test command uses a disposable database. Never run destructive test fixtures against the application's data. Browser smoke tests create a disposable account and disable it after success; use a test environment.

For calibration, sample collection, quantization boundaries, and the descriptor-proof design, refer to PRE-ZKML.md, using this document's password flow in place of its historical passkey/invitation sections.
