// UI regression checks with generated non-face video and mocked password API.
// The real detector must reject these pixels. Real proof/session behavior is
// covered separately by server/tests/test_face_login.py.
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
const origin = process.env.M4_TEST_ORIGIN || 'http://localhost:5173'
try {
  for (const portrait of [false, true]) {
    const context = await browser.newContext({ viewport: portrait ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: portrait, hasTouch: portrait })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    let signedIn = false
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      const body = route.request().postDataJSON()
      let code = 200, data = {}
      if (path === '/api/login/options') {
        if (body.username === 'server_error') return route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' })
        data = { challenge_id: 'ui-test' }
      }
      else if (path === '/api/login/verify') {
        signedIn = body.password === 'test-password'
        if (!signedIn) { code = 401; data = { detail: 'Password incorrect.' } }
      } else if (path === '/api/session') {
        code = signedIn ? 200 : 401
        data = signedIn ? { account: { id: 'ui-test', username: 'camera_user', display_name: 'Camera user' }, csrf: 'test-csrf', authentication: 'password', enrollment: {scheme:'privface-zkml-demo-v1',commitment:'test',version:1} } : { detail: 'Not signed in' }
      } else if (path === '/api/health') data = {status:'ok'}
      else if (path === '/api/logout') signedIn = false
      else throw Error('Unexpected API request: ' + path)
      await route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.addInitScript(portrait => {
      window.testStreams = []
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async constraints => {
        if (constraints.audio !== false || constraints.video.facingMode !== 'user') throw Error('Expected front camera without audio')
        const canvas = document.createElement('canvas')
        canvas.width = portrait ? 720 : 640; canvas.height = portrait ? 1280 : 480
        const context = canvas.getContext('2d')
        let tick = 0
        const draw = () => { context.fillStyle = '#354759'; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#537693'; context.fillRect((tick++ * 10) % 400, 400, 40, 20) }
        draw()
        const timer = setInterval(draw, 60), stream = canvas.captureStream(15)
        window.testStreams.push(stream)
        window.addEventListener('pagehide', () => { clearInterval(timer); stream.getTracks().forEach(track => track.stop()) })
        if (window.testDelayPermission) await new Promise(resolve => { window.testResolvePermission = resolve })
        return stream
      } })
    }, portrait)
    const runtimeResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/zkml/face-login.mjs')
    await page.goto(origin + '/face-login.html')
    const runtime = await runtimeResponse
    assert.equal(runtime.status(), 200, 'Face-login runtime must load in dev and production')
    assert.equal(new URL(runtime.url()).searchParams.has('import'), false, 'Public runtime must not be sent through Vite transforms')
    await page.waitForFunction(() => typeof document.getElementById('camera')?.onclick === 'function')
    assert.equal(await page.locator('vite-error-overlay').count(), 0)
    await page.locator('#username').fill('camera_user')
    assert.equal(await page.locator('#continue').isVisible(), false)
    assert.equal(await page.locator('#capture').isDisabled(), true)
    await page.locator('#camera').click()
    await page.locator('#camera-status').filter({ hasText: 'No face detected' }).waitFor({ timeout: 45000 })
    assert.equal(await page.locator('#capture').isDisabled(), true)
    assert.equal(await page.locator('#enroll').isDisabled(), true)
    assert.equal(await page.locator('#login').isDisabled(), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.locator('#stop').click()
    assert.equal(await page.evaluate(() => window.testStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true)
    // Cancel while the permission request is still unresolved, then release it.
    await page.evaluate(() => { window.testDelayPermission = true })
    await page.locator('#camera').click()
    await page.waitForFunction(() => window.testResolvePermission)
    await page.locator('#stop').click()
    await page.evaluate(() => { window.testResolvePermission(); window.testDelayPermission = false })
    await page.waitForFunction(() => window.testStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))
    assert.equal(await page.locator('#camera').isEnabled(), true)
    await page.locator('#mode-enroll').click()
    assert.equal(await page.locator('#password').isVisible(), true)
    assert.equal(await page.locator('#enroll-note').isVisible(), true)
    await page.locator('#camera').click()
    await page.locator('#status').filter({ hasText: 'Enter your account password' }).waitFor()
    await page.locator('#mode-password').click()
    assert.equal(await page.locator('#camera-section').isVisible(), false)
    await page.locator('#username').fill('server_error')
    await page.locator('#password').fill('test-password')
    await page.locator('#password-login').click()
    await page.locator('#status').filter({ hasText: 'Server request failed (HTTP 500)' }).waitFor()
    assert.equal(await page.locator('#continue').isVisible(), false)
    await page.locator('#username').fill('camera_user')
    await page.locator('#password').fill('incorrect')
    await page.locator('#password-login').click()
    await page.locator('#status').filter({ hasText: 'Password incorrect' }).waitFor()
    assert.equal(await page.locator('#continue').isVisible(), false)
    await page.locator('#password').fill('test-password')
    await page.locator('#password-login').click()
    await page.locator('#continue').waitFor({ state: 'visible' })
    assert.equal(await page.locator('#continue').getAttribute('href'), '/dashboard')
    assert.equal(await page.locator('#signed-in').textContent(), 'Signed in as @camera_user.')
    assert.equal(await page.locator('#password').inputValue(), '')
    assert.equal(await page.locator('#flow-form').isVisible(), false)
    assert.equal(await page.locator('#success-panel').isVisible(), true)
    await page.locator('#logout').click()
    await page.locator('#status').filter({ hasText: 'Signed out.' }).waitFor()
    assert.equal(await page.locator('#continue').isVisible(), false)
    assert.equal(await page.locator('#mode-login').getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('#password').isVisible(), false)
    if (process.env.SCREENSHOT_DIR) await page.screenshot({path:process.env.SCREENSHOT_DIR + '/' + (portrait ? 'phone' : 'laptop') + '.png',fullPage:true})
    // Isolated camera stub checks captured-frame UI without pretending to test recognition.
    await page.route('**/src/face-login-camera.ts', route => route.fulfill({contentType:'text/javascript',body:`
      export const CAPTURE_FORMAT='ui-test';
      export class FaceLoginCamera {
        constructor(video,feedback){this.video=video;this.feedback=feedback}
        async start(){const c=document.createElement('canvas');this.video.srcObject=c.captureStream();this.feedback('Ready to capture.',true)}
        stop(){this.video.srcObject?.getTracks().forEach(t=>t.stop());this.video.srcObject=null;this.feedback('Camera off.',false)}
        capture(){return Array(1024).fill(128)}
      }`}))
    if (!process.env.M4_PRODUCTION_PREVIEW) {
      await page.reload()
      await page.locator('#username').fill('camera_user')
      await page.locator('#camera').click()
      await page.locator('#capture').click()
      assert.equal(await page.locator('#login').isVisible(),true)
      assert.equal(await page.locator('#enroll').isVisible(),false)
      assert.equal(await page.locator('#capture-preview').isVisible(),true)
      await page.locator('#mode-enroll').click()
      assert.equal(await page.locator('#capture-preview').isVisible(),false)
      await page.locator('#password').fill('test-password')
      await page.locator('#camera').click()
      await page.locator('#capture').click()
      assert.equal(await page.locator('#enroll').isVisible(),true)
      assert.equal(await page.locator('#login').isVisible(),false)
    }
    signedIn = true
    await page.goto(origin + '/')
    await page.getByRole('link',{name:'Open face login',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Verify my face',exact:true}).count(),0)
    assert.equal(await page.locator('video').count(),0)
    await page.getByText('Account security',{exact:true}).click()
    assert.equal(await page.getByRole('button',{name:'Link or refresh saved face enrollment'}).count(),0)
    await page.getByRole('button',{name:'Set up face',exact:true}).click()
    await page.locator('section[aria-label="Face login enrollment"] a').click()
    await page.waitForFunction(()=>document.getElementById('mode-enroll')?.getAttribute('aria-pressed')==='true')
    assert.equal(await page.locator('#password').isVisible(),true)
    assert.deepEqual(errors, [])
    console.log(`PASS: ${portrait ? 'phone portrait' : 'laptop landscape'} real detector rejects non-face video; stop and late permission release tracks; password fallback and confirmed-session continuation`)
    await context.close()
  }
} finally { await browser.close() }
