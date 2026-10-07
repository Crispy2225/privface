# ISL Face Authentication

Privacy-preserving face authentication using local machine learning and zero-knowledge proofs.

## Current milestone

The client has a modern Register/Login interface, camera preview, local face validation, and a prototype active liveness challenge in both flows. Enter details, continue to the face step, and choose **Enable camera**. The browser requests video permission only. Preview, capture, retake, discard, and stop controls work locally.

Captured photos are held only in React memory. They are never uploaded, saved in browser storage, or written to disk. They are cleared on leaving the face step, switching Login/Register, hiding the page, or reloading. Camera tracks stop after capture, on Stop, when leaving the face step, and when the page is hidden or unloaded. Late permission grants after cancellation are stopped immediately.

Face detection, heuristic movement checks, local embedding generation, and browser-local registration are implemented. Register saves an encrypted 128-dimensional pretrained face template in IndexedDB, associated with a case-insensitive username, after separate storage consent. The photo is discarded after saving. Duplicate usernames cannot be overwritten; existing local enrollment can be deleted from Register after entering the same username. Identity matching, server account creation/binding, nonce handling, ZK proofs, and login sessions are not implemented. Sign-in remains disabled. Local enrollment is not a server authentication result.

The server-binding decision and its trust limits are documented in [docs/enrollment-binding.md](docs/enrollment-binding.md): authorize an account-bound, versioned hiding commitment using a verified account bootstrap, WebAuthn user verification, and an expiring single-use server challenge. This protocol is a design, not a placeholder verifier or an implemented server registration endpoint.

## Stack and layout

- `client/`: React + TypeScript, served by Vite. Face validation, pretrained embedding generation, and encrypted local enrollment run here. Future proof generation also belongs on the client.
- `server/`: FastAPI + Uvicorn. Future challenges and proof verification belong here.
- `client/package-lock.json`: locked JavaScript dependencies.
- `server/requirements.txt`: locked Python dependencies.

The development browser calls `/api/health` on Vite. Vite proxies `/api/*` to `http://127.0.0.1:8000`. This avoids cross-origin browser requests and does not require permissive CORS settings.

## Prerequisites

- Node.js 22.12+ (Node 24 works) and npm.
- Python 3.12. Use a project virtual environment; do not install into macOS system Python.

## First-time setup

Run from the project root:

```sh
python3.12 -m venv server/.venv
server/.venv/bin/python -m pip install -r server/requirements.txt
npm --prefix client ci
```

On the original development machine, Python 3.12 was provided by the Codex runtime. The existing `server/.venv` is already configured. For a fresh setup on that machine, if `python3.12` is unavailable, use:

```sh
/Users/atharv/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m venv server/.venv
```

## Run locally

Open two terminals in the project root.

**Terminal 1 — server**

```sh
server/.venv/bin/python -m uvicorn app.main:app --app-dir server --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — client**

```sh
npm --prefix client run dev
```

- Browser client: http://127.0.0.1:5173
- Interactive API documentation: http://127.0.0.1:8000/docs
- Health endpoint: http://127.0.0.1:8000/api/health

The client should show **Server connected**. Stop either process with Ctrl+C in its terminal. Both processes bind to loopback only.

## Appearance

Use the sun/moon button in the header to switch between Light and Dark. On the first visit, the site follows the system appearance and subsequent system changes. Choosing a mode saves `privface-theme` in local browser storage and remembers it across reloads. Captured photos remain in memory; explicitly consented face templates persist separately in IndexedDB until deleted or site data is cleared.

## Configuration

Defaults work without environment files. To change the development server target, copy `client/.env.example` to `client/.env.local`, edit `API_PROXY_TARGET`, and restart Vite. If you change the server port, also pass the matching port to Uvicorn.

Never put secrets in `VITE_*` variables: those variables are available to browser code. Local environment files, captured images, embeddings, model files, and proof artifacts are ignored by Git.

## Validate the foundation

```sh
npm --prefix client run build
curl --fail http://127.0.0.1:8000/api/health
curl --fail http://127.0.0.1:5173/api/health
```

Both health requests should return:

```json
{"status":"ok","service":"isl-verification-server","version":"0.1.0"}
```

The build command checks TypeScript and produces `client/dist/`. Production hosting is a later milestone: it must serve the client and route `/api` to the server. `vite preview` only previews the built UI and is not the integrated development setup.

If the page shows **Server unavailable**, check the server terminal, port 8000, and the proxy target, then select **Recheck** in the footer. Vite uses a strict port so an existing process on 5173 causes a clear startup error.

## Interface walkthrough

1. Choose Register and enter a display name, username, and the device-setup acknowledgment; or choose Login and enter a username.
2. Continue to the face step and choose **Enable camera**. Allow the browser's camera request. Your microphone stays off.
3. Center exactly one face. After the face model loads, follow three randomized instructions: close/reopen both eyes, turn toward the left arrow and return, and turn toward the right arrow and return. Hold each turn briefly.
4. When **Ready to capture** appears, choose **Capture photo** within six seconds. The exact captured frame is checked again for one centered, forward-facing face. The camera turns off and shows a local photo preview.
5. Choose **Retake photo** to reopen the camera, or **Discard** to clear the photo. **Stop camera** ends a live preview without capturing.
6. In Register, consent to retaining a face template and choose **Save local face enrollment**. The pretrained model runs on-device, the encrypted template is saved for the username, and the photo is discarded. The template is scoped to this browser profile and origin (including port); it is not uploaded or bound to a server account. Existing enrollment can be deleted here, including after reloading and entering the same username again.
7. Edit, Back, switching sections, and hiding the page all release the camera and cancel pending enrollment. No successful server login is simulated.

Camera access requires localhost or HTTPS. If access is blocked, enable the camera for this site in browser settings and allow the browser under macOS System Settings → Privacy & Security → Camera. If the embedded browser cannot provide camera access, open the same URL in Safari, Chrome, or Firefox. Close other camera apps if the camera is busy. You can cancel a pending permission request without keeping a stream alive if permission arrives later.

Run camera lifecycle tests with `npm --prefix client test`. These use fake media streams to verify video-only constraints, cleanup, delayed grants, concurrent requests, and error messages. They do not activate hardware. Liveness and landmark-validation tests also cover still observations, incorrect gestures, missing/multiple faces, stale frames, timeouts, malformed landmarks, and capture expiration.

## Next milestones

1. Validate face/liveness and the new local enrollment flow with real cameras and a consented spoof-test set; evaluate descriptor accuracy and matching thresholds.
2. Quantization and a small proof feasibility experiment.
3. Account-bound enrollment, expiring single-use challenges, and real proof verification.

Keep raw facial data and embeddings on the device. Never implement successful authentication using a placeholder verifier. Final model, proving framework, storage, and deployment choices remain open.

## Face validation and liveness prototype

MediaPipe Face Landmarker runs locally on downscaled frames (up to 640 pixels wide), about 10 times per second on the main thread. The detector supports up to two faces so multiple detected faces disable capture. Feedback covers face absence, size, centering, clipping, missing landmarks, and sudden position changes. Head turns use a nose-to-eye geometry heuristic and eye checks use bilateral blink blendshapes. The on-screen direction refers to the mirrored preview.

The randomized challenge requires a neutral baseline, open–closed–open eyes, both head directions with returns to center, and a final neutral pose. Missing/multiple faces, invalid framing, video gaps over 650 ms, and timeouts reset it. Capture is allowed for six seconds with observations no older than 500 ms; the same canvas frame is revalidated before encoding. Capture stays disabled on model errors. Stop/restart retries model loading. Retake starts a fresh challenge. No liveness result is sent to or trusted by the server.

**Security boundary:** these are heuristics, not certified presentation-attack detection. A stationary image cannot complete the scripted eye/motion sequence in the deterministic tests, but this has not established resistance to real-world photos, cutouts, bent prints, replayed videos, deepfakes, virtual cameras, or modified browser code. Landmark continuity is not identity continuity. Thresholds are provisional and need evaluation across cameras, lighting, glasses, and users. The browser cannot enforce trusted enrollment by itself. Server registration and sign-in remain unavailable until the enrollment protocol, stronger spoof protection, and server verification are implemented and evaluated. Do not label this result “identity verified” or “spoof-proof.”

### Local recognition model and template storage

`face-api.js` 0.22.2 supplies Tiny Face Detector, the tiny 68-point alignment model, and the pretrained 128-dimensional recognition network. Assets are checked in under `client/public/vision/recognition/`, sourced from a pinned upstream commit recorded in `client/scripts/recognition-checksums.json`. `predev` and `prebuild` verify every file's SHA-256. Runtime model requests are same-origin; descriptors and photos are never sent to the API. The library is MIT licensed; see the [upstream documentation](https://github.com/justadudewhohacks/face-api.js) for model provenance and licenses. `download-recognition.mjs` is a maintainer update tool that deliberately replaces assets and checksums; ordinary startup never downloads them remotely.

Templates use AES-256-GCM with a fresh per-record non-extractable Web Crypto key and authenticated username/model/schema metadata. Keys live in IndexedDB beside encrypted templates: same-origin scripts or a compromised browser can decrypt them. This is prototype storage, not hardware-backed protection. No matching threshold or normalization is introduced before evaluation.

`npm --prefix client test` also verifies template encryption, tamper rejection, cancelled writes, durable key cloning, deletion and duplicate races using fake IndexedDB. For a real-browser model/storage smoke test, run the Vite dev server and open `/tests/recognition-smoke.html`; it loads the recognition models, rejects a blank image and stores/deletes a synthetic descriptor. It does not use a camera or establish recognition accuracy.

### Local model assets

- Package: `@mediapipe/tasks-vision`, exact version in `package-lock.json` (Apache-2.0).
- Model source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
- Model SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.
- Official model documentation and model cards: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker

The public, pretrained model is checked into `client/public/vision/face_landmarker.task`; it contains no user biometrics. `predev` and `prebuild` validate its checksum and copy matching WASM files from the installed package into the ignored `client/public/vision/wasm/` directory. Production builds include both assets. No CDN runtime is used, and inference makes no network calls with frames or landmarks. If updating the model, review its source and update the checksum deliberately.

### Manual acceptance checks before relying on this prototype

Use a real webcam to check: one face can complete all prompts; no face and two faces block capture; too-small/off-center faces produce guidance; still printed/displayed photos cannot finish; timeout, stopped/frozen video, page hiding, and retake revoke progress; and model-load failure leaves capture disabled. Also attempt replayed videos and record false accepts/rejects. Passing the automated state-machine tests does not substitute for these hardware and spoof tests.
