import { useEffect, useRef, useState } from 'react'
import { api, authorizeBinding, loginAccount, registerAccount } from './passkeys'
import type { AccountSession } from './passkeys'
import { getEnrollment } from './enrollment-store'
import { prepareBinding } from './template-binding'

export default function AccountAccess({ username, onAccount }: { username: string; onAccount: (username: string, name: string) => void }) {
  const [session, setSession] = useState<AccountSession | null>(null)
  const [invitation, setInvitation] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => { void api<AccountSession>('/session', undefined, undefined, controller.signal).then(setSession).catch(() => { if (!controller.signal.aborted) setSession(null) }) }
    refresh()
    window.addEventListener('privface-session', refresh)
    return () => { controller.abort(); active.current?.abort(); window.removeEventListener('privface-session', refresh) }
  }, [])

  async function run(action: 'register' | 'login' | 'bind' | 'logout') {
    if (active.current) return
    const controller = new AbortController(); active.current = controller
    setBusy(true); setMessage('Waiting for authorization…')
    try {
      if (action === 'register' || action === 'login') {
        const result = action === 'register' ? await registerAccount(invitation.trim(), controller.signal) : await loginAccount(username, controller.signal)
        controller.signal.throwIfAborted()
        setSession(result); setInvitation(''); onAccount(result.account.username, result.account.display_name)
        setMessage('Account authorized with your passkey. You can now bind your local enrollment.')
      } else if (action === 'logout' && session) {
        await api('/logout', {}, session.csrf, controller.signal)
        setSession(null); setMessage('Signed out.')
      } else if (session) {
        const record = await getEnrollment(session.account.username)
        if (!record) throw new Error('Save a local face enrollment for @' + session.account.username + ' first.')
        const binding = await prepareBinding(session.account.id, record, controller.signal)
        const result = await authorizeBinding(binding, session.csrf, controller.signal)
        controller.signal.throwIfAborted()
        setSession({ ...session, enrollment: { commitment: result.commitment, version: result.version } })
        setMessage('Local template commitment authorized for your account (version ' + result.version + ').')
      }
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Authorization failed.') }
    finally { if (active.current === controller) { active.current = null; setBusy(false) } }
  }

  return <section className="account-access" aria-label="Server account">
    <h3>Server account</h3>
    {session ? <>
      <p>Signed in as <strong>@{session.account.username}</strong> with a passkey.</p>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => void run('bind')}>{session.enrollment ? 'Authorize a new template binding' : 'Bind saved face enrollment'}</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => void run('logout')}>Sign out</button>
    </> : <>
      <label className="field">Account invitation<input type="password" autoComplete="off" value={invitation} onChange={event => setInvitation(event.target.value)} placeholder="Invitation from the project operator" /></label>
      <button className="secondary-button" type="button" disabled={busy || !invitation.trim()} onClick={() => void run('register')}>Create account with passkey</button>
      <button className="text-button" type="button" disabled={busy || !/^[a-zA-Z0-9_]{3,32}$/.test(username)} onClick={() => void run('login')}>Sign in with passkey for entered username</button>
    </>}
    {message && <p role="status" className="camera-feedback">{message}</p>}
    <p className="implementation-note">Passkeys authorize server access. Face templates remain in this browser.</p>
  </section>
}
