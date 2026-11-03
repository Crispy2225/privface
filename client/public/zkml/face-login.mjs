import {loadArtifacts,makeEnrollment,inputsFor,runWorker} from './client.mjs'

export function initialize(FaceLoginCamera, captureFormat, cameraErrorMessage) {
const $ = id => document.getElementById(id)
let pixels, capturedAt = 0, controller, busy = false, requesting = false, cameraRequest = 0
const status = text => { $('status').textContent = text }
const user = () => $('username').value.trim().toLowerCase()
const camera = new FaceLoginCamera($('video'), (message, ready) => {
  $('camera-status').textContent = message
  $('capture').disabled = !ready || busy
})
async function api(path, body, csrf, signal) {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-privface-request': '1', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
  })
  const data = await response.json()
  if (!response.ok) throw Error(data.detail || 'Request failed')
  return data
}
function clearCapture() {
  pixels?.fill(0); pixels = null; capturedAt = 0
  $('preview').getContext('2d').clearRect(0, 0, 32, 32)
  $('enroll').disabled = $('login').disabled = true
}
function stop() { cameraRequest++; requesting = false; camera.stop(); clearCapture() }
function controls() {
  for (const id of ['username', 'password', 'password-login', 'logout', 'forget']) $(id).disabled = busy
  $('camera').disabled = busy || requesting
  $('enroll').disabled = $('login').disabled = busy || !pixels
  $('cancel').disabled = !busy
  if (busy || pixels) $('capture').disabled = true
}
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
  controls(); status('Face captured. Choose enroll or log in within one minute, or retake.')
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
    status('Checking your face and generating a private proof on this device…')
    const result = await runWorker(artifacts, input, signal)
    status('Verifying with server…')
    await api('face/' + (enroll ? 'enroll' : 'login') + '/verify', { challenge_id: options.challenge_id, proof: result.result.proof, publicSignals: result.result.publicSignals }, session?.csrf, signal)
    signal.throwIfAborted()
    if (enroll) { await save(name, template); await record(name + ':pending', undefined, true) }
    await showSession(signal)
    status(enroll ? 'Enrollment verified and saved. You can continue, or sign out to try face login.' : 'Face proof accepted. You can now continue to your account.')
  } finally { captured.fill(0); clearCapture() }
}
function action(id, fn) {
  $(id).onclick = async () => {
    if (busy || requesting) return
    busy = true; controller = new AbortController(); controls()
    try { await fn(controller.signal) }
    catch (error) { status(error.name === 'AbortError' ? 'Cancelled. Capture again to retry.' : error.message) }
    finally { busy = false; controller = null; $('password').value = ''; controls() }
  }
}
$('camera').onclick = async () => {
  if (busy || requesting) return
  const request = ++cameraRequest
  requesting = true; clearCapture(); controls()
  try { await camera.start() }
  catch (error) { if (request === cameraRequest) status(error.name === 'Error' ? error.message : cameraErrorMessage(error)) }
  finally { if (request === cameraRequest) { requesting = false; controls() } }
}
$('capture').onclick = () => { if (!busy) { try { capture() } catch (error) { status(error.message); controls() } } }
$('stop').onclick = () => { controller?.abort(); stop(); status('Camera stopped. Start it again for a fresh capture.'); controls() }
action('enroll', signal => prove(true, signal))
action('login', signal => prove(false, signal))
action('password-login', async signal => { await passwordLogin(signal); stop(); await showSession(signal); status('Signed in with password. You can now continue to your account.') })
action('logout', async signal => {
  const session = await api('session', undefined, undefined, signal)
  await api('logout', {}, session.csrf, signal)
  $('continue').hidden = true; $('signed-in').textContent = ''; stop(); status('Signed out.')
})
action('forget', async () => {
  await record(user(), undefined, true); await record(user() + ':pending', undefined, true)
  clearCapture(); status('Local template removed. Use password login to replace the server enrollment.')
})
$('cancel').onclick = () => { controller?.abort(); stop() }
$('username').addEventListener('input', () => { stop(); $('continue').hidden = true; $('signed-in').textContent = ''; controls() })
const clear = () => { controller?.abort(); stop(); $('password').value = ''; controls() }
document.addEventListener('visibilitychange', () => { if (document.hidden) clear() })
window.addEventListener('pagehide', clear)
setInterval(() => { if (!busy && pixels && performance.now() - capturedAt > 60000) { clearCapture(); controls(); status('Capture expired. Take a fresh photo to continue.') } }, 1000)
controls()
}
