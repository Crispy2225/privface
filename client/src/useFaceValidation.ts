import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { FaceLandmarker } from '@mediapipe/tasks-vision'
import { INITIAL_VALIDATION, LivenessSession } from './liveness'
import type { Validation } from './liveness'
import { observationFromResult } from './face-observation'

type CaptureHandle = { capture: () => string | null; restart: () => void }

export function useFaceValidation(video: RefObject<HTMLVideoElement | null>, active: boolean) {
  const [validation, setValidation] = useState<Validation>(INITIAL_VALIDATION)
  const handle = useRef<CaptureHandle | null>(null)

  useEffect(() => {
    if (!active) { handle.current = null; setValidation(INITIAL_VALIDATION); return }
    let disposed = false
    let detector: FaceLandmarker | null = null
    let frame = 0
    let lastFrameTime = -1
    let lastProcessedAt = 0
    let lastModelTimestamp = 0
    let loadingTimer = 0
    const session = new LivenessSession()
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    setValidation(INITIAL_VALIDATION)

    function publish(result: Validation) { if (!disposed) setValidation(result) }
    function fail() {
      session.reset()
      handle.current = null
      publish({ state: 'error', message: 'Face detection could not run. Stop and restart the camera. If this persists, try a current Chrome or Safari browser.', completed: 0, canCapture: false })
    }
    function analyze() {
      const element = video.current
      if (!detector || !element || !context || !element.srcObject || element.readyState < 2 || !element.videoWidth) return null
      // The detector and capture use this exact canvas frame; no unvalidated photo upload path.
      const scale = Math.min(1, 640 / element.videoWidth)
      canvas.width = Math.round(element.videoWidth * scale)
      canvas.height = Math.round(element.videoHeight * scale)
      context.drawImage(element, 0, 0, canvas.width, canvas.height)
      const now = performance.now()
      lastModelTimestamp = Math.max(now, lastModelTimestamp + 0.01)
      const observation = observationFromResult(detector.detectForVideo(canvas, lastModelTimestamp))
      const result = session.observe(observation, now)
      publish(result)
      return result
    }
    function loop() {
      if (disposed) return
      const now = performance.now()
      const element = video.current
      try {
        if (element && element.readyState >= 2 && element.currentTime !== lastFrameTime && now - lastProcessedAt >= 90) {
          lastFrameTime = element.currentTime
          lastProcessedAt = now
          analyze()
        } else if (now - lastProcessedAt > 650) {
          publish(session.reset('Waiting for live video. Keep the camera connected.'))
        }
      } catch { fail(); return }
      frame = requestAnimationFrame(loop)
    }
    loadingTimer = window.setTimeout(() => {
      // A slow/failed load never enables capture; a late model is closed below.
      if (!detector && !disposed) { disposed = true; handle.current = null; setValidation({ state: 'error', message: 'Face model loading timed out. Stop and restart the camera to retry.', completed: 0, canCapture: false }) }
    }, 30000)
    void import('./face-detector').then(module => module.createFaceDetector()).then(instance => {
      window.clearTimeout(loadingTimer)
      if (disposed) { instance.close(); return }
      detector = instance
      if (!context) { fail(); return }
      handle.current = {
        restart: () => { publish(session.reset()); lastProcessedAt = performance.now() },
        capture: () => {
          if (disposed || !session.isFresh(performance.now()) || !video.current || performance.now() - lastProcessedAt > 500) {
            publish(session.reset('Repeat the movement check before capturing.'))
            return null
          }
          try {
            // Revalidate the capture frame, including exactly-one-face and neutral pose.
            const result = analyze()
            if (!result?.canCapture) return null
            return canvas.toDataURL('image/jpeg', 0.9)
          } catch { fail(); return null }
        },
      }
      lastProcessedAt = performance.now()
      loop()
    }).catch(() => { window.clearTimeout(loadingTimer); if (!disposed) fail() })

    return () => {
      disposed = true
      handle.current = null
      cancelAnimationFrame(frame)
      window.clearTimeout(loadingTimer)
      detector?.close()
      canvas.width = canvas.height = 0
    }
  }, [active, video])

  return { validation, captureValidatedPhoto: () => handle.current?.capture() ?? null, restartValidation: () => handle.current?.restart() }
}
