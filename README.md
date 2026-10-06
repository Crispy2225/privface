# ISL Face Authentication

Privacy-preserving face authentication using local machine learning and zero-knowledge proofs.

## Current milestone

The client has a modern Register/Login interface, camera preview, local face validation, and a prototype active liveness challenge in both flows. Enter details, continue to the face step, and choose **Enable camera**. The browser requests video permission only. Preview, capture, retake, discard, and stop controls work locally.

Captured photos are held only in React memory. They are never uploaded, saved in browser storage, or written to disk. They are cleared on leaving the face step, switching Login/Register, hiding the page, or reloading. Camera tracks stop after capture, on Stop, when leaving the face step, and when the page is hidden or unloaded. Late permission grants after cancellation are stopped immediately.

Face detection and heuristic movement checks are implemented. Actual enrollment, identity matching, nonce handling, ZK proofs, and login sessions are not implemented. The final register/sign-in buttons remain disabled. A captured photo or healthy API is not an authentication result.

## Stack and layout

- `client/`: React + TypeScript, served by Vite. Future local face processing and proof generation belong on the client.
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

Use the sun/moon button in the header to switch between Light and Dark. On the first visit, the site follows the system appearance and subsequent system changes. Choosing a mode saves `privface-theme` in local browser storage and remembers it across reloads. Only the appearance preference is persisted; captured photos remain in memory.

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
6. Edit, Back, switching sections, and hiding the page all release the camera. No account or successful login is simulated.

Camera access requires localhost or HTTPS. If access is blocked, enable the camera for this site in browser settings and allow the browser under macOS System Settings → Privacy & Security → Camera. If the embedded browser cannot provide camera access, open the same URL in Safari, Chrome, or Firefox. Close other camera apps if the camera is busy. You can cancel a pending permission request without keeping a stream alive if permission arrives later.

Run camera lifecycle tests with `npm --prefix client test`. These use fake media streams to verify video-only constraints, cleanup, delayed grants, concurrent requests, and error messages. They do not activate hardware. Liveness and landmark-validation tests also cover still observations, incorrect gestures, missing/multiple faces, stale frames, timeouts, malformed landmarks, and capture expiration.

## Next milestones

1. Validate the face/liveness prototype with real cameras and a consented spoof-test set, then implement local embeddings and enrollment.
2. Quantization and a small proof feasibility experiment.
3. Account-bound enrollment, expiring single-use challenges, and real proof verification.

Keep raw facial data and embeddings on the device. Never implement successful authentication using a placeholder verifier. Final model, proving framework, storage, and deployment choices remain open.

## Face validation and liveness prototype

MediaPipe Face Landmarker runs locally on downscaled frames (up to 640 pixels wide), about 10 times per second on the main thread. The detector supports up to two faces so multiple detected faces disable capture. Feedback covers face absence, size, centering, clipping, missing landmarks, and sudden position changes. Head turns use a nose-to-eye geometry heuristic and eye checks use bilateral blink blendshapes. The on-screen direction refers to the mirrored preview.

The randomized challenge requires a neutral baseline, open–closed–open eyes, both head directions with returns to center, and a final neutral pose. Missing/multiple faces, invalid framing, video gaps over 650 ms, and timeouts reset it. Capture is allowed for six seconds with observations no older than 500 ms; the same canvas frame is revalidated before encoding. Capture stays disabled on model errors. Stop/restart retries model loading. Retake starts a fresh challenge. No liveness result is sent to or trusted by the server.

**Security boundary:** these are heuristics, not certified presentation-attack detection. A stationary image cannot complete the scripted eye/motion sequence in the deterministic tests, but this has not established resistance to real-world photos, cutouts, bent prints, replayed videos, deepfakes, virtual cameras, or modified browser code. Landmark continuity is not identity continuity. Thresholds are provisional and need evaluation across cameras, lighting, glasses, and users. The browser cannot enforce trusted enrollment by itself. Production registration remains disabled until the enrollment protocol, stronger spoof protection, and server verification are designed and evaluated. Do not label this result “identity verified” or “spoof-proof.”

### Local model assets

- Package: `@mediapipe/tasks-vision`, exact version in `package-lock.json` (Apache-2.0).
- Model source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
- Model SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.
- Official model documentation and model cards: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker

The public, pretrained model is checked into `client/public/vision/face_landmarker.task`; it contains no user biometrics. `predev` and `prebuild` validate its checksum and copy matching WASM files from the installed package into the ignored `client/public/vision/wasm/` directory. Production builds include both assets. No CDN runtime is used, and inference makes no network calls with frames or landmarks. If updating the model, review its source and update the checksum deliberately.

### Manual acceptance checks before relying on this prototype

Use a real webcam to check: one face can complete all prompts; no face and two faces block capture; too-small/off-center faces produce guidance; still printed/displayed photos cannot finish; timeout, stopped/frozen video, page hiding, and retake revoke progress; and model-load failure leaves capture disabled. Also attempt replayed videos and record false accepts/rejects. Passing the automated state-machine tests does not substitute for these hardware and spoof tests.
