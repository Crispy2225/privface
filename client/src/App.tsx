import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import CameraCapture from './CameraCapture'
import StudyCollection from './StudyCollection'
import SiteHeader from './SiteHeader'
import AccountAccess from './AccountAccess'
import Dashboard from './Dashboard'
import { api, registerAccount, loginAccount } from './account-api'
import type { AccountSession } from './account-api'

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
  const isRegister=mode==='register'
  const [session,setSession]=useState<AccountSession|null>(null)
  const usesFaceLogin = session?.enrollment?.scheme === 'privface-zkml-demo-v1'
  const [checking,setChecking]=useState(true),[busy,setBusy]=useState(false)
  const [username,setUsername]=useState('')
  const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[consent,setConsent]=useState(false)
  const [message,setMessage]=useState('')
  const active=useRef<AbortController|null>(null),id=useId()
  function accept(value:AccountSession|null){setSession(value);if(value){setUsername(value.account.username)}}
  useEffect(()=>{
    const controller=new AbortController()
    const refresh=()=>{void api<AccountSession>('/session',undefined,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)accept(value)}).catch(()=>{if(!controller.signal.aborted)setSession(null)}).finally(()=>{if(!controller.signal.aborted)setChecking(false)})}
    refresh();window.addEventListener('privface-session',refresh)
    return()=>{controller.abort();active.current?.abort();window.removeEventListener('privface-session',refresh)}
  },[])
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(active.current)return
    if(isRegister&&password!==confirm){setMessage('Passwords do not match.');return}
    const controller=new AbortController();active.current=controller;setBusy(true);setMessage('')
    try{
      const result=isRegister?await registerAccount(username,username,password,controller.signal):await loginAccount(username,password,controller.signal)
      controller.signal.throwIfAborted();accept(result)
    }catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:'Unable to continue.')}
    finally{setPassword('');setConfirm('');if(active.current===controller){active.current=null;setBusy(false)}}
  }
  return <section className="auth-panel" aria-labelledby={`${id}-title`}>
    <div className="mode-switch" aria-label="Choose login or registration">
      <button type="button" disabled={busy} aria-pressed={!isRegister} onClick={()=>{if(isRegister)onSwitch()}}>{session?(usesFaceLogin?'Account':'Verify face'):'Log in'}</button>
      <button type="button" disabled={busy} aria-pressed={isRegister} onClick={()=>{if(!isRegister)onSwitch()}}>{session?'Set up face':'Register'}</button>
    </div>
    <div className="panel-heading">
      <h2 id={`${id}-title`}>{session?(isRegister?'Set up your face.':'You’re signed in.'):(isRegister?'Create your account.':'Welcome back.')}</h2>
      <p>{session?(isRegister?(usesFaceLogin?'Manage your saved face in the face-login flow.':'Your account is ready. Capture and save your face to finish face setup.'):(usesFaceLogin?'Your account session is active. No additional face check is required.':'You can optionally verify your face on this browser.')):(isRegister?'Choose a username and password, then capture your face.':'Sign in with your username and password.')}</p>
    </div>
    {checking?<p role="status">Checking your session…</p>:!session?<form onSubmit={submit}>
      <div className="field"><label htmlFor={`${id}-username`}>Username</label><input id={`${id}-username`} value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="[a-zA-Z0-9_]{3,32}" minLength={3} maxLength={32} title="Use 3–32 letters, numbers, or underscores." required /></div>
      <div className="field"><label htmlFor={`${id}-password`}>Password</label><input id={`${id}-password`} type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={isRegister?'new-password':'current-password'} minLength={isRegister?12:1} maxLength={128} required />{isRegister&&<p className="field-hint">Use 12–128 characters. A long, unique passphrase works well.</p>}</div>
      {isRegister&&<><div className="field"><label htmlFor={`${id}-confirm`}>Confirm password</label><input id={`${id}-confirm`} type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} maxLength={128} required /></div><label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required /><span>I agree to set up my face enrollment locally on this browser.</span></label></>}
      <button className="primary-button" disabled={busy} type="submit">{busy?'Please wait…':isRegister?'Create account & capture face':'Log in'}</button>
      {message&&<p className="camera-error" role="alert">{message}</p>}
    </form>:usesFaceLogin?<section aria-label="Face login enrollment">
      <p>Your account uses the face-login enrollment. The earlier local face comparison uses a different template format.</p>
      <a className="primary-button" href={isRegister?'/face-login.html?mode=enroll':'/face-login.html'}>{isRegister?'Manage face enrollment':'Open face login'}</a>
      {!isRegister&&<p className="camera-privacy">To rehearse face-only login, sign out first, then open Face login and leave the password blank. Your saved enrollment remains available.</p>}
    </section>:<CameraCapture key={session.account.id+mode} enrollment={isRegister?{username:session.account.username,displayName:session.account.display_name}:undefined} verificationUsername={isRegister?undefined:session.account.username} />}
    {!checking&&session&&<a className="primary-button" style={{marginTop:16,textDecoration:'none'}} href="/dashboard">Open dashboard →</a>}
    {!checking&&<AccountAccess session={session} onSession={accept} />}
    {!session&&<p className="switch-prompt">{isRegister?'Already registered?':'New to PrivFace?'} <button className="text-button" disabled={busy} onClick={onSwitch}>{isRegister?'Log in':'Create an account'}</button></p>}
  </section>
}

export default function App() {
  const [mode, setMode] = useState<Mode>('login')
  if(window.location.pathname==='/dashboard') return <Dashboard />
  if(window.location.pathname==='/study') return <div className="page-shell"><SiteHeader /><StudyCollection /></div>
  return <div className="page-shell">
    <SiteHeader />
    <main className="auth-layout">
      <section className="intro" aria-labelledby="intro-title">
        <span className="privacy-pill"><span />INTRODUCING PRIVFACE</span>
        <h1 id="intro-title">Simply you.<br /><em>Securely in.</em></h1>
        <p className="intro-description">A more personal way to sign in. Designed to recognize you while keeping your face data yours.</p>
        <div className="face-art" aria-hidden="true"><div className="art-glow" /><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-core"><FaceMark /></div><span className="art-label"><LockIcon /> Your face. Your device.</span><i className="orbit-dot dot-one" /><i className="orbit-dot dot-two" /></div>
        <div className="principles" id="how-it-works"><div><span>01</span><strong>Enroll once</strong><p>A face setup for your account.</p></div><div><span>02</span><strong>Verify locally</strong><p>Your face stays on your device.</p></div><div><span>03</span><strong>Authorize access</strong><p>Sign in with your password.</p></div></div>
        <p className="design-note">Username-and-password accounts with optional local face verification. Face images stay on your device.</p>
      </section>
      <div className="form-column"><AuthForm key={mode} mode={mode} onSwitch={() => setMode(current => current === 'login' ? 'register' : 'login')} /><div className="preview-note"><LockIcon /><span>Built for your eyes only.</span>Face enrollment stays in this browser. Passwords authorize sign-in.</div></div>
    </main>
    <footer className="site-footer"><span>PrivFace · Privacy-preserving face authentication</span><ServerStatus /></footer>
  </div>
}
