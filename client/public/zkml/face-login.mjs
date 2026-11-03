import {loadArtifacts,makeEnrollment,inputsFor,runWorker} from './client.mjs'
import {infer,squaredDistance,decimal,commitment} from './runtime.mjs'

// UX preflight only. Successful logins still require the full server-verified proof.
export function inspectCaptureMatch(artifacts, template, pixels) {
  const limit = Number(decimal(artifacts.policy.limit, 32, true))
  const probe = infer(artifacts.model, pixels)
  try {
    const distance = squaredDistance(template.embedding, probe)
    return { matched: distance <= limit, distance, limit }
  }
  finally { probe.fill(0) }
}

export function captureMatches(artifacts, template, pixels) {
  return inspectCaptureMatch(artifacts, template, pixels).matched
}

export function initialize(FaceLoginCamera, captureFormat, cameraErrorMessage) {
const $ = id => document.getElementById(id)
let pixels, capturedAt = 0, controller, busy = false, requesting = false, cameraRequest = 0, mode = 'login', signedIn = false
const status = (text, kind = 'info') => { $('status').textContent = text; $('status-box').dataset.kind = kind }
const user = () => $('username').value.trim().toLowerCase()
const diagnostics = document.createElement('details')
diagnostics.id = 'match-diagnostics'; diagnostics.hidden = true
const summary = document.createElement('summary'); summary.textContent = 'Local match diagnostics'
const diagnosticText = document.createElement('p')
diagnostics.append(summary, diagnosticText); $('status').after(diagnostics)
const clearDiagnostics = () => { diagnostics.hidden = true; diagnosticText.textContent = '' }

const camera = new FaceLoginCamera($('video'), (message, ready) => {
  $('camera-status').textContent = message
  $('capture').disabled = !ready || busy
  controls()
})
async function api(path, body, csrf, signal) {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-privface-request': '1', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
  })
  let data
  try { data = await response.json() }
  catch (error) {
    signal?.throwIfAborted()
    throw Error(response.ok ? 'The server returned an unreadable response. Please try again.' : `Server request failed (HTTP ${response.status}). Please try again; if it persists, report this message.`)
  }
  if (!response.ok) throw Error(typeof data?.detail === 'string' ? data.detail : `Request failed (HTTP ${response.status})`)
  return data
}
function clearCapture() {
  pixels?.fill(0); pixels = null; capturedAt = 0
  $('preview').getContext('2d').clearRect(0, 0, 32, 32)
  $('enroll').disabled = $('login').disabled = true
}
function stop() { cameraRequest++; requesting = false; camera.stop(); clearCapture() }
function controls() {
  const live = Boolean($('video').srcObject)
  for (const id of ['username', 'password', 'password-login', 'logout', 'forget', 'mode-login', 'mode-enroll', 'mode-password', 'another-login']) $(id).disabled = busy
  $('camera').disabled = busy || requesting
  $('enroll').disabled = $('login').disabled = busy || !pixels
  $('cancel').disabled = !busy; $('cancel').hidden = !busy
  $('busy-indicator').hidden = !busy
  if (busy || pixels || !live) $('capture').disabled = true
  $('flow-form').hidden = signedIn
  $('success-panel').hidden = !signedIn
  $('password-fields').hidden = mode === 'login'
  $('password-login').hidden = mode !== 'password'
  $('enroll-note').hidden = mode !== 'enroll'
  $('camera-section').hidden = mode === 'password'
  $('camera-placeholder').hidden = live || Boolean(pixels)
  $('capture-preview').hidden = !pixels
  $('camera-badge').hidden = !live
  $('camera').hidden = live || requesting || busy
  $('camera').textContent = pixels ? 'Retake photo' : 'Start camera →'
  $('capture').hidden = !live || busy
  $('stop').hidden = (!live && !requesting) || busy
  $('login').hidden = mode !== 'login' || !pixels
  $('enroll').hidden = mode !== 'enroll' || !pixels
  for (const choice of ['login', 'enroll', 'password']) $('mode-' + choice).setAttribute('aria-pressed', String(mode === choice))
  const activeStep = signedIn ? 'done' : busy ? 'verify' : 'capture'
  for (const step of ['capture', 'verify', 'done']) {
    if (step === activeStep) $('step-' + step).setAttribute('aria-current', 'step')
    else $('step-' + step).removeAttribute('aria-current')
  }
  $('flow-title').textContent = signedIn ? 'You’re signed in.' : mode === 'enroll' ? 'Set up your face.' : mode === 'password' ? 'Sign in with a password.' : 'Sign in with your face.'
  $('flow-description').textContent = signedIn ? 'Your session has been confirmed by the server.' : mode === 'enroll' ? 'Authorize face setup with your account password.' : mode === 'password' ? 'Access your account without using the camera.' : 'Use the browser where you saved your face enrollment.'
  $('flow-eyebrow').textContent = signedIn ? 'ACCESS CONFIRMED' : mode === 'enroll' ? 'FACE ENROLLMENT' : 'WELCOME BACK'
}
function switchMode(next) {
  if (busy) return
  stop(); clearDiagnostics(); mode = next; $('password').value = ''
  status(next === 'enroll' ? 'Enter your username and password, then capture your face.' : next === 'password' ? 'Enter your account credentials to continue.' : 'Enter your username to begin.')
  controls(); $('username').focus()
}
for (const choice of ['login', 'enroll', 'password']) $('mode-' + choice).onclick = () => switchMode(choice)
async function database(){return new Promise((ok,no)=>{const r=indexedDB.open('privface-face-demo-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
async function record(name,value,remove=false){const db=await database();try{return await new Promise((ok,no)=>{const tx=db.transaction('records',value!==undefined||remove?'readwrite':'readonly'),s=tx.objectStore('records');let result;const r=remove?s.delete(name):value===undefined?s.get(name):s.put(value,name);r.onsuccess=()=>result=r.result;tx.oncomplete=()=>ok(result);tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error||Error('Storage aborted'))})}finally{db.close()}}
async function save(name,template){const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(name)},key,new TextEncoder().encode(JSON.stringify(template)));await record(name,{key,iv,encrypted})}
async function read(name){const r=await record(name);if(!r)throw Error('No local enrollment on this browser. Sign in with password and enroll.');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:r.iv,additionalData:new TextEncoder().encode(name)},r.key,r.encrypted)))}
function capture() {
  clearCapture()
  pixels = camera.capture(); capturedAt = performance.now()
  camera.stop()
  const context = $('preview').getContext('2d'), image = context.createImageData(32, 32)
  pixels.forEach((value, i) => { image.data.set([value, value, value, 255], i * 4) })
  context.putImageData(image, 0, 0)
  controls(); status(mode === 'enroll' ? 'Capture ready. Choose Save face enrollment to finish setup.' : 'Capture ready. Choose Verify & sign in to continue.')
}
async function passwordLogin(signal) {
  const name = user(), password = $('password').value
  if (!name || !password) throw Error('Enter your username and password for this step.')
  const options = await api('login/options', { username: name }, undefined, signal)
  return api('login/verify', { ...options, password }, undefined, signal)
}
async function showSession(signal) {
  const session = await api('session', undefined, undefined, signal)
  signal?.throwIfAborted()
  $('signed-in').textContent = 'Signed in as @' + session.account.username + '.'
  $('continue').hidden = false
  signedIn = true; controls()
}
async function prove(enroll, signal) {
  if (!pixels || performance.now() - capturedAt > 60000) { clearCapture(); throw Error('Capture a fresh face before continuing.') }
  const name = user()
  if (!name) throw Error('Enter your username')
  const captured = pixels.slice()
  let template, options, session
  try {
    status('Loading model…')
    const artifacts = await loadArtifacts(signal)
    if (enroll) {
      session = await passwordLogin(signal)
      const account = BigInt('0x' + session.account.id.replaceAll('-', '')).toString()
      template = { ...makeEnrollment(artifacts, captured, account), captureFormat }
      options = await api('face/enroll/options', { password: $('password').value, enrollmentRoot: template.enrollmentRoot }, session.csrf, signal)
      template.bindingVersion = options.inputs.bindingVersion
      await save(name + ':pending', template)
    } else {
      options = await api('face/login/options', { username: name }, undefined, signal)
      try { template = await read(name) } catch {}
      if (template?.enrollmentRoot !== options.inputs.enrollmentRoot) template = await read(name + ':pending')
      if (template.captureFormat !== captureFormat) throw Error('Face capture has improved. Sign in with your password and enroll again on this browser.')
    }
    signal.throwIfAborted()
    $('password').value = ''
    if (options.setupId !== artifacts.manifest.setupId) throw Error('Server setup changed. Reload and re-enroll.')
    const input = inputsFor(artifacts, template, captured, enroll ? 1 : 2, options.inputs.nonce)
    for (const [key, value] of Object.entries(options.inputs)) if (input[key] !== value) throw Error('Enrollment changed. Sign in with password and re-enroll.')
    if (!enroll) {
      if (commitment(template.account, artifacts.manifest.modelTag, template.embedding, template.blinding, artifacts.params) !== template.enrollmentRoot) {
        throw Error('The local template does not match its saved commitment. Use password login to repair enrollment.')
      }
      const match = inspectCaptureMatch(artifacts, template, captured)
      diagnosticText.textContent = `Squared distance: ${match.distance}. Acceptance limit: ${match.limit}. Lower is closer; this is not a confidence percentage. Local template commitment and server binding agree. Model and capture format are compatible. These numbers are shown locally and are not uploaded or saved.`
      diagnostics.hidden = false
      if (!match.matched) throw Error('Face did not match the saved enrollment. Use password login if this repeats. Expand Local match diagnostics below for the measured distance.')
    }
    status('Checking your face and generating a private proof on this device…')
    const result = await runWorker(artifacts, input, signal)
    status('Verifying with server…')
    await api('face/' + (enroll ? 'enroll' : 'login') + '/verify', { challenge_id: options.challenge_id, proof: result.result.proof, publicSignals: result.result.publicSignals }, session?.csrf, signal)
    signal.throwIfAborted()
    if (enroll) { await save(name, template); await record(name + ':pending', undefined, true) }
    await showSession(signal)
    status(enroll ? 'Enrollment verified and saved. You can continue, or sign out to try face login.' : 'Face proof accepted. You can now continue to your account.', 'success')
  } finally { captured.fill(0); clearCapture() }
}
function action(id, fn) {
  $(id).onclick = async () => {
    if (busy || requesting) return
    clearDiagnostics(); busy = true; controller = new AbortController(); controls()
    try { await fn(controller.signal) }
    catch (error) { status(error.name === 'AbortError' ? 'Cancelled. Capture again to retry.' : error.message, 'error') }
    finally { busy = false; controller = null; $('password').value = ''; controls() }
  }
}
$('camera').onclick = async () => {
  if (busy || requesting) return
  if (!$('username').checkValidity() || !user()) { status('Enter a username with 3–32 letters, numbers, or underscores.', 'error'); $('username').focus(); return }
  if (mode === 'enroll' && !$('password').value) { status('Enter your account password before starting face setup.', 'error'); $('password').focus(); return }
  status('Follow the camera instructions below.')
  const request = ++cameraRequest
  requesting = true; clearCapture(); clearDiagnostics(); controls()
  try { await camera.start() }
  catch (error) { if (request === cameraRequest) status(error.name === 'Error' ? error.message : cameraErrorMessage(error), 'error') }
  finally { if (request === cameraRequest) { requesting = false; controls() } }
}
$('capture').onclick = () => { if (!busy) { try { capture() } catch (error) { status(error.message); controls() } } }
$('stop').onclick = () => { controller?.abort(); stop(); status('Camera stopped. Start it again for a fresh capture.'); controls() }
action('enroll', signal => prove(true, signal))
action('login', signal => prove(false, signal))
action('password-login', async signal => { await passwordLogin(signal); stop(); await showSession(signal); status('Signed in with password. You can now continue to your account.', 'success') })
action('logout', async signal => {
  const session = await api('session', undefined, undefined, signal)
  await api('logout', {}, session.csrf, signal)
  signedIn = false; mode = 'login'; $('continue').hidden = true; $('signed-in').textContent = ''; stop(); status('Signed out.'); controls()
})
action('forget', async () => {
  await record(user(), undefined, true); await record(user() + ':pending', undefined, true)
  clearCapture(); status('Local template removed. Use password login to replace the server enrollment.')
})
$('another-login').onclick = () => $('logout').click()
$('cancel').onclick = () => { controller?.abort(); stop() }
$('username').addEventListener('input', () => { stop(); clearDiagnostics(); signedIn = false; $('continue').hidden = true; $('signed-in').textContent = ''; controls() })
const clear = () => { controller?.abort(); stop(); clearDiagnostics(); $('password').value = ''; controls() }
document.addEventListener('visibilitychange', () => { if (document.hidden) clear() })
window.addEventListener('pagehide', clear)
setInterval(() => { if (!busy && pixels && performance.now() - capturedAt > 60000) { clearCapture(); controls(); status('Capture expired. Take a fresh photo to continue.') } }, 1000)
if (new URLSearchParams(location.search).get('mode') === 'enroll') switchMode('enroll')
controls()
}
