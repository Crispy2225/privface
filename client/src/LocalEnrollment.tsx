import { useEffect, useRef, useState } from 'react'
import { generateEmbedding } from './face-embedding'
import { encryptTemplate } from './template-crypto'
import { deleteEnrollment, hasEnrollment, saveEnrollment } from './enrollment-store'

export default function LocalEnrollment({ photo, username, displayName, clearPhoto }: {
  photo: string | null; username: string; displayName: string; clearPhoto: () => void
}) {
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)
  const active = useRef<AbortController | null>(null)
  useEffect(() => {
    let disposed = false
    void hasEnrollment(username).then(exists => {
      if (!disposed) { setSaved(exists); if (exists) setMessage('This username is already enrolled in this browser. You can delete its local template below.') }
    }).catch(error => { if (!disposed) setMessage(error instanceof Error ? error.message : 'Local storage unavailable.') })
    return () => { disposed = true }
  }, [username])
  useEffect(() => {
    const cancel = () => { active.current?.abort(); active.current = null; setBusy(false) }
    const hidden = () => { if (document.visibilityState === 'hidden') cancel() }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', cancel)
    return () => { cancel(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', cancel) }
  }, [photo, username])

  async function register() {
    if (!photo || !consent || active.current || saved) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setMessage('Generating your face template on this device…')
    let embedding: number[] | null = null
    try {
      embedding = await generateEmbedding(photo, controller.signal)
      const encrypted = await encryptTemplate(username, displayName.trim(), embedding)
      controller.signal.throwIfAborted()
      await saveEnrollment(encrypted, controller.signal)
      setSaved(true)
      setMessage('Local enrollment saved for @' + username.toLowerCase() + '. No server account has been created.')
      clearPhoto()
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Enrollment failed. Retake your photo and try again.')
    } finally {
      embedding?.fill(0)
      if (active.current === controller) { active.current = null; setBusy(false) }
    }
  }

  async function remove() {
    setBusy(true)
    try { await deleteEnrollment(username); setSaved(false); setConsent(false); setMessage('Local enrollment deleted. Capture a new photo to enroll again.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete enrollment.') }
    finally { setBusy(false) }
  }

  return <section className="local-enrollment" aria-label="Local face enrollment">
    {!saved && <label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>Save my face template in this browser for this username. It remains until I delete it or clear site data.</span></label>}
    <button className="primary-button" type="button" disabled={!photo || !consent || busy || saved} onClick={() => void register()}>{busy ? 'Preparing enrollment…' : saved ? 'Enrolled on this device' : 'Save local face enrollment'}</button>
    {message && <p className="camera-feedback" role="status">{message}</p>}
    {saved && <button className="text-button" disabled={busy} type="button" onClick={() => void remove()}>Delete local enrollment</button>}
    <p className="camera-privacy">The photo is discarded after saving. The encrypted numerical template stays in this browser. Server binding and sign-in are still in development.</p>
  </section>
}
