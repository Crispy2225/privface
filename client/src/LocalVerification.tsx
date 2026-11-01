import { useEffect, useRef, useState } from 'react'
import { getEnrollment } from './enrollment-store'
import { decryptTemplate, EMBEDDING_MODEL } from './template-crypto'
import { generateEmbedding } from './face-embedding'
import { compareFaces, QUANTIZATION } from './face-match'
import policy from './match-policy.json'
import { proofConfig, proveMatch } from './proof-client'
import { api } from './account-api'
import type { AccountSession } from './account-api'

export default function LocalVerification({ photo, username, clearPhoto }: { photo: string | null; username: string; clearPhoto: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => {
    const cancel = () => { active.current?.abort(); active.current = null; setBusy(false) }
    const hidden = () => { if (document.hidden) cancel() }
    document.addEventListener('visibilitychange', hidden)
    return () => { cancel(); document.removeEventListener('visibilitychange', hidden) }
  }, [photo, username])

  async function verify() {
    if (!photo || active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true); setMessage('Comparing your face on this device…')
    let enrolled: number[] | undefined, probe: number[] | undefined
    try {
      if (policy.model !== EMBEDDING_MODEL || policy.quantization !== QUANTIZATION) throw new Error('Matching policy does not match the current model.')
      const record = await getEnrollment(username)
      if (!record) throw new Error('No local enrollment for this username. Register on this browser first.')
      enrolled = await decryptTemplate(record)
      probe = await generateEmbedding(photo, controller.signal)
      controller.signal.throwIfAborted()
      const config=await proofConfig(controller.signal)
      const result = compareFaces(enrolled, probe, config.enabled ? config.policy.threshold : policy.threshold)
      if (!result.matched) { setMessage(`Face did not match (distance ${result.distance.toFixed(3)}, limit ${result.threshold}). Retake in better lighting.`); return }
      const session=await api<AccountSession>('/session',undefined,undefined,controller.signal)
      if(session.account.username!==username.toLowerCase())throw new Error('Sign in to the matching account first.')
      controller.signal.throwIfAborted()
      let proved=false
      if(config.enabled) {
        setMessage('Face matched. Creating a private descriptor proof on this device…')
        await proveMatch(session,record,probe,controller.signal); proved=true
      }
      setMessage(`Face matched for @${session.account.username}. ${proved ? 'Server verified the private descriptor comparison.' : 'Face comparison stayed on this device.'}`)
      window.dispatchEvent(new Event('privface-session'))
      clearPhoto()
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Verification failed.')
    } finally {
      enrolled?.fill(0); probe?.fill(0)
      if (active.current === controller) { active.current = null; setBusy(false) }
    }
  }
  return <section aria-label="Local face verification">
    <button className="primary-button" type="button" disabled={!photo || busy} onClick={() => void verify()}>{busy ? 'Verifying…' : 'Verify my face'}</button>
    {!policy.calibrated && <p className="implementation-note">Experimental comparison: the acceptance threshold has not been calibrated with participant data.</p>}
    {message && <p role="status" className="camera-feedback">{message}</p>}
  </section>
}
