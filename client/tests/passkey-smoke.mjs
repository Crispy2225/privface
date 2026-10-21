// Requires a running app, a fresh invitation, and Playwright/Chrome.
// Uses a virtual authenticator and SYNTHETIC descriptors; never a real camera.
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const invitation = (await readFile(process.env.PRIVFACE_INVITATION_FILE, 'utf8')).trim()
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
  await page.goto(process.env.PRIVFACE_URL || 'http://localhost:5173')
  await page.getByLabel('Account invitation').fill(invitation)
  await page.getByRole('button', { name: 'Create account with passkey' }).click()
  await page.getByText('Account authorized with your passkey.', { exact: false }).waitFor()
  const session = await page.evaluate(async () => (await fetch('/api/session')).json())
  assert.equal(session.authentication, 'passkey')
  await page.evaluate(async ({ username }) => {
    const { encryptTemplate } = await import('/src/template-crypto.ts')
    const { saveEnrollment } = await import('/src/enrollment-store.ts')
    const record = await encryptTemplate(username, 'Synthetic smoke test', Array.from({ length: 128 }, (_, i) => (i+1)/256))
    await saveEnrollment(record, new AbortController().signal)
  }, { username: session.account.username })
  await page.getByRole('button', { name: 'Bind saved face enrollment' }).click()
  await page.getByText('Local template commitment authorized', { exact: false }).waitFor()
  const bound = await page.evaluate(async () => (await fetch('/api/session')).json())
  assert.equal(bound.enrollment.version, 1)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByText('Signed out.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sign in with passkey for entered username' }).click()
  await page.getByText('Account authorized with your passkey.', { exact: false }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: browser passkey registration, encrypted synthetic enrollment, binding, logout and passkey login; no page errors.')
} finally { await browser.close() }
