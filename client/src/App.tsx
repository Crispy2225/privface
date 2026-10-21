import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import CameraCapture from './CameraCapture'
import ThemeToggle from './ThemeToggle'
import AccountAccess from './AccountAccess'

type Mode = 'login' | 'register'
type Connection = 'checking' | 'connected' | 'offline'

function FaceMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'face-mark small' : 'face-mark'} viewBox="0 0 80 80" fill="none" aria-hidden="true">
    <path d="M24 10H16a6 6 0 0 0-6 6v8m46-14h8a6 6 0 0 1 6 6v8M10 56v8a6 6 0 0 0 6 6h8m32 0h8a6 6 0 0 0 6-6v-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path d="M28 31v7m24-7v7M39 32v13h5m-16 8c7 6 17 6 24 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function LockIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" stroke="currentColor" strokeWidth="1.6" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
}

function ServerStatus() {
  const [connection, setConnection] = useState<Connection>('checking')
  const activeRequest = useRef<AbortController | null>(null)

  async function checkServer() {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setConnection('checking')
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch('/api/health', { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error('Health check failed')
      const body: unknown = await response.json()
      if (typeof body !== 'object' || body === null || !('status' in body) || body.status !== 'ok') throw new Error('Unexpected response')
      if (activeRequest.current === controller) setConnection('connected')
    } catch {
      if (activeRequest.current === controller) setConnection('offline')
    } finally {
      window.clearTimeout(timeout)
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }

  useEffect(() => {
    void checkServer()
    return () => { activeRequest.current?.abort(); activeRequest.current = null }
  }, [])

  return <div className="server-status">
    <span role="status" aria-live="polite"><i className={`status-dot ${connection}`} />{connection === 'connected' ? 'Server connected' : connection === 'offline' ? 'Server unavailable' : 'Connecting to server…'}</span>
    <button className="text-button" onClick={() => void checkServer()} disabled={connection === 'checking'} aria-label="Check server connection">Recheck</button>
  </div>
}

function AuthForm({ mode, onSwitch }: { mode: Mode; onSwitch: () => void }) {
  const isRegister = mode === 'register'
  const [step, setStep] = useState<'details' | 'face'>('details')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [consent, setConsent] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const id = useId()

  useEffect(() => { if (step === 'face') headingRef.current?.focus() }, [step])

  function continueToFace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStep('face')
  }

  return <section className="auth-panel" aria-labelledby={`${id}-title`}>
    <div className="mode-switch" aria-label="Choose login or registration">
      <button type="button" aria-pressed={!isRegister} onClick={() => { if (isRegister) onSwitch() }}>Log in</button>
      <button type="button" aria-pressed={isRegister} onClick={() => { if (!isRegister) onSwitch() }}>Register</button>
    </div>

    <AccountAccess username={username} onAccount={(user, display) => { setUsername(user); setName(display) }} />

    <div className="panel-heading">
      <span className="eyebrow">{isRegister ? 'CREATE YOUR PRIVFACE ACCOUNT' : 'YOUR PRIVFACE ACCOUNT'}</span>
      <h2 ref={headingRef} tabIndex={-1} id={`${id}-title`}>{step === 'face' ? (isRegister ? 'Set up your face.' : 'Verify it’s you.') : (isRegister ? 'Hello, you.' : 'Welcome back.')}</h2>
      <p>{step === 'face' ? (isRegister ? 'Start with a clear photo. Your camera preview stays on this device.' : 'Compare a fresh photo locally, then confirm your passkey.') : (isRegister ? 'Create your account, then register your face once.' : 'Enter your username to continue with face verification.')}</p>
    </div>

    <ol className="steps" aria-label={isRegister ? 'Registration steps' : 'Login steps'}>
      <li aria-current={step === 'details' ? 'step' : undefined} className={step === 'face' ? 'completed' : ''}><span>{step === 'face' ? '✓' : '1'}</span>{isRegister ? 'Your details' : 'Your account'}</li>
      <li aria-current={step === 'face' ? 'step' : undefined}><span>2</span>{isRegister ? 'Register face' : 'Verify face'}</li>
    </ol>

    {step === 'details' ? <form onSubmit={continueToFace}>
      {isRegister && <div className="field"><label htmlFor={`${id}-name`}>Display name</label><input id={`${id}-name`} name="name" autoComplete="name" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} maxLength={80} pattern=".*\S.*" required /></div>}
      <div className="field"><label htmlFor={`${id}-username`}>Username</label><input id={`${id}-username`} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="e.g. atharv" value={username} onChange={e => setUsername(e.target.value)} minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" title="Use 3–32 letters, numbers, or underscores." aria-describedby={`${id}-username-help`} required /><p className="field-hint" id={`${id}-username-help`}>{isRegister ? '3–32 letters, numbers, or underscores.' : 'Use the username you chose during registration.'}</p></div>
      {isRegister && <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required /><span>I understand that face enrollment will be set up on this device.</span></label>}
      <button className="primary-button" type="submit">{isRegister ? 'Continue to face setup' : 'Continue to face verification'}<span aria-hidden="true">→</span></button>
      <p className="under-button"><LockIcon />No password to create or remember.</p>
    </form> : <div className="face-step">
      <div className="account-chip"><span className="avatar">{(isRegister ? name.trim() : username).slice(0, 1).toUpperCase()}</span><span>{isRegister ? name.trim() : username}<small>@{username}</small></span><button className="text-button" onClick={() => setStep('details')}>Edit</button></div>
      <CameraCapture key={username} enrollment={isRegister ? { username, displayName: name } : undefined} verificationUsername={isRegister ? undefined : username} />
      <p className="implementation-note" id={`${id}-unavailable`}>{isRegister ? 'Local registration saves a face template for this browser. Use the server-account panel to authorize its binding with your passkey.' : 'Face comparison stays local. Server sign-in requires your passkey; ZK verification is not yet implemented.'}</p>
      <button className="back-button" type="button" onClick={() => setStep('details')}>← Back to {isRegister ? 'your details' : 'your account'}</button>
    </div>}

    <p className="switch-prompt">{isRegister ? 'Already registered?' : 'New to PrivFace?'} <button className="text-button" onClick={onSwitch}>{isRegister ? 'Log in' : 'Create an account'} <span aria-hidden="true">↗</span></button></p>
  </section>
}

export default function App() {
  const [mode, setMode] = useState<Mode>('login')
  return <div className="page-shell">
    <header className="site-header"><a className="brand" href="/" aria-label="PrivFace home"><FaceMark small /><span>privface<span className="brand-period">.</span></span></a><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><span className="project-label"><LockIcon /> On-device privacy</span><ThemeToggle /></nav></header>
    <main className="auth-layout">
      <section className="intro" aria-labelledby="intro-title">
        <span className="privacy-pill"><span />INTRODUCING PRIVFACE</span>
        <h1 id="intro-title">Simply you.<br /><em>Securely in.</em></h1>
        <p className="intro-description">A more personal way to sign in. Designed to recognize you while keeping your face data yours.</p>
        <div className="face-art" aria-hidden="true"><div className="art-glow" /><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-core"><FaceMark /></div><span className="art-label"><LockIcon /> Your face. Your device.</span><i className="orbit-dot dot-one" /><i className="orbit-dot dot-two" /></div>
        <div className="principles" id="how-it-works"><div><span>01</span><strong>Enroll once</strong><p>A face setup for your account.</p></div><div><span>02</span><strong>Verify locally</strong><p>Your face stays on your device.</p></div><div><span>03</span><strong>Authorize access</strong><p>Authorize with your passkey.</p></div></div>
        <p className="design-note">Local face matching and passkey authorization. Zero-knowledge proofs are a future stage.</p>
      </section>
      <div className="form-column"><AuthForm key={mode} mode={mode} onSwitch={() => setMode(current => current === 'login' ? 'register' : 'login')} /><div className="preview-note"><LockIcon /><span>Built for your eyes only.</span>Face enrollment stays in this browser. Passkeys authorize sign-in.</div></div>
    </main>
    <footer className="site-footer"><span>PrivFace · Privacy-preserving face authentication</span><ServerStatus /></footer>
  </div>
}
