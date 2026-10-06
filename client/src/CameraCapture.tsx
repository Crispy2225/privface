import { useEffect, useRef, useState } from 'react'
import { CameraSession, cameraErrorMessage } from './camera-session'
import { useFaceValidation } from './useFaceValidation'

type Status = 'idle' | 'requesting' | 'live' | 'captured' | 'error'

function CameraIcon() {
  return <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5.5 9.5 3h5L16 5.5h3A2 2 0 0 1 21 7.5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><circle cx="12" cy="12.5" r="4" stroke="currentColor" strokeWidth="1.4" /></svg>
}

export default function CameraCapture() {
  const session = useRef(new CameraSession())
  const video = useRef<HTMLVideoElement>(null)
  const mounted = useRef(false)
  const [status, setStatus] = useState<Status>('idle')
  const [ready, setReady] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [error, setError] = useState('')
  const { validation, captureValidatedPhoto, restartValidation } = useFaceValidation(video, status === 'live' && ready)

  function releaseCamera() {
    session.current.stop()
    if (video.current) video.current.srcObject = null
  }

  function stopCamera() {
    releaseCamera()
    setReady(false)
    setStatus('idle')
    setError('')
  }

  useEffect(() => {
    mounted.current = true
    function onHide() {
      if (document.visibilityState === 'hidden') {
        releaseCamera()
        setReady(false)
        setPhoto(null)
        setStatus('idle')
        setError('')
      }
    }
    function onPageHide() {
      releaseCamera()
      setPhoto(null)
      setReady(false)
      setStatus('idle')
      setError('')
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      mounted.current = false
      releaseCamera()
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  async function startCamera() {
    setPhoto(null)
    setError('')
    setReady(false)
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error')
      setError('Camera access needs HTTPS or localhost and a supported browser. Try opening this page in Safari, Chrome, or Firefox.')
      return
    }
    setStatus('requesting')
    try {
      const stream = await session.current.start(constraints => navigator.mediaDevices.getUserMedia(constraints))
      if (!stream || !mounted.current) return
      const element = video.current
      if (!element) { releaseCamera(); return }
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (!mounted.current || element.srcObject !== stream) return
        releaseCamera()
        setReady(false)
        setStatus('error')
        setError('Camera access ended. Reconnect your camera or allow access, then try again.')
      }, { once: true }))
      element.srcObject = stream
      setStatus('live')
      try { await element.play() } catch (playError) {
        // Stop/navigation may interrupt play; only report errors for this stream.
        if (mounted.current && element.srcObject === stream) throw playError
      }
    } catch (cameraError) {
      if (!mounted.current) return
      releaseCamera()
      setStatus('error')
      setError(cameraErrorMessage(cameraError))
    }
  }

  function capturePhoto() {
    const element = video.current
    if (!element || element.readyState < 2 || !element.videoWidth || !ready) return
    try {
      const validatedPhoto = captureValidatedPhoto()
      if (!validatedPhoto) return
      setPhoto(validatedPhoto)
      setError('')
      releaseCamera()
      setReady(false)
      setStatus('captured')
    } catch {
      setError('We couldn’t capture that frame. Try again or restart the camera.')
    }
  }

  return <div className="camera-capture">
    <div className={`camera-view ${status}`}>
      <video ref={video} autoPlay playsInline muted aria-label="Live camera preview" className={status === 'live' ? 'visible' : ''} onLoadedData={() => { if (video.current?.srcObject) setReady(true) }} />
      {photo && <img className="captured-photo" src={photo} alt="Your captured photo, held only in this page’s memory" />}
      {status === 'live' && <><div className="face-guide" aria-hidden="true" /><span className="camera-live"><i />CAMERA ON</span><span className="frame-instruction">{validation.canCapture ? 'Ready to capture' : 'Follow the movement check below'}</span></>}
      {status === 'captured' && <span className="camera-live captured-label">PHOTO PREVIEW · CAMERA OFF</span>}
      {status !== 'live' && status !== 'captured' && <div className="camera-empty"><div className="camera-icon"><CameraIcon /></div><strong>{status === 'requesting' ? 'Allow your camera.' : 'Let’s see you.'}</strong><p>{status === 'requesting' ? 'Choose Allow in your browser’s camera prompt.' : 'Find good lighting and look straight ahead.'}</p><span className="camera-off-label">{status === 'requesting' ? 'Waiting for permission' : 'Your camera is off'}</span></div>}
    </div>
    <div className="camera-feedback" aria-live="polite" role="status">{status === 'captured' ? 'Photo captured locally. It has not been uploaded or used to register or sign in.' : status === 'live' ? 'Live preview. Nothing is being recorded or uploaded.' : status === 'requesting' ? 'Only video access is requested. Your microphone stays off.' : 'Camera access starts only when you choose Enable camera.'}</div>
    {status === 'requesting' && <p className="camera-privacy">No permission prompt? Open this page in Safari, Chrome, or Firefox and enable camera access for this site.</p>}
    {status === 'live' && <section className={`face-validation ${validation.state}`} aria-label="Face and movement check">
      <div className="validation-heading"><strong>{validation.state === 'loading' ? 'Preparing face detection' : validation.canCapture ? 'Ready to capture' : 'Face & movement check'}</strong><span>{validation.completed}/3</span></div>
      <div className="validation-progress" aria-hidden="true">{[0, 1, 2].map(index => <i key={index} className={index < validation.completed ? 'complete' : ''} />)}</div>
      <p role="status" aria-live="polite">{validation.message}</p>
      {validation.state !== 'loading' && validation.state !== 'error' && <button className="text-button" type="button" onClick={restartValidation}>Restart check</button>}
    </section>}
    {error && <p className="camera-error" role="alert">{error}</p>}
    <div className="camera-actions">
      {status === 'live' ? <><button type="button" className="primary-button" onClick={capturePhoto} disabled={!ready || !validation.canCapture}>Capture photo<span aria-hidden="true">◎</span></button><button type="button" className="secondary-button" onClick={stopCamera}>Stop camera</button></> : status === 'requesting' ? <button type="button" className="secondary-button full-width" onClick={stopCamera}>Cancel camera request</button> : status === 'captured' ? <><button type="button" className="primary-button" onClick={() => void startCamera()}>Retake photo<span aria-hidden="true">↻</span></button><button type="button" className="secondary-button" onClick={() => { setPhoto(null); stopCamera() }}>Discard</button></> : <button type="button" className="primary-button" onClick={() => void startCamera()}>{status === 'error' ? 'Try camera again' : 'Enable camera'}<CameraIcon /></button>}
    </div>
    <p className="liveness-notice">Prototype movement check. This is not certified spoof protection and may be bypassed by video replays or generated faces.</p>
    <p className="camera-privacy">Photos stay in this page’s memory and are cleared when you leave this step or hide the page.</p>
  </div>
}
