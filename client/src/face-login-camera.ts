import { CameraSession } from './camera-session'
import { createFaceDetector } from './face-detector'
import { observationFromResult } from './face-observation'
import { checkFaceQuality, faceBounds, faceCrop } from './face-quality'
import { LivenessSession } from './liveness'
import type { FaceLandmarker } from '@mediapipe/tasks-vision'

export const CAPTURE_FORMAT = 'landmark-square-v1'

export class FaceLoginCamera {
  private camera = new CameraSession()
  private detector: FaceLandmarker | null = null
  private generation = 0
  private frame = 0
  private lastVideoTime = -1
  private lastFrameAt = 0
  private modelTime = 0
  private liveness = new LivenessSession()
  private canvas = document.createElement('canvas')
  private sample = document.createElement('canvas')
  private output = document.createElement('canvas')
  private ready = false
  private crop: ReturnType<typeof faceCrop> = null

  constructor(private video: HTMLVideoElement, private feedback: (message: string, ready: boolean) => void) {}

  stop() {
    this.generation++
    cancelAnimationFrame(this.frame)
    this.camera.stop()
    this.video.srcObject = null
    this.detector?.close(); this.detector = null
    this.ready = false; this.crop = null
    this.liveness.reset()
    for (const canvas of [this.canvas, this.sample, this.output]) canvas.width = canvas.height = 0
    this.feedback('Camera off. Start it when you are ready.', false)
  }

  async start() {
    this.stop()
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS or localhost. Open this page in Safari, Chrome, or Firefox.')
    const generation = this.generation
    this.feedback('Allow camera access. Your microphone stays off.', false)
    try {
      const stream = await this.camera.start(constraints => navigator.mediaDevices.getUserMedia(constraints))
      if (!stream || generation !== this.generation) return
      this.video.srcObject = stream
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (generation !== this.generation) return
        this.stop(); this.feedback('Camera disconnected. Restart it to try again.', false)
      }, { once: true }))
      await this.video.play()
      if (generation !== this.generation) return
      this.feedback('Preparing face detection on this device…', false)
      let timer: ReturnType<typeof setTimeout> | undefined
      const pending = createFaceDetector().then(detector => {
        if (generation !== this.generation) detector.close()
        return detector
      })
      let detector: FaceLandmarker
      try {
        detector = await Promise.race([pending, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Face detection loading timed out. Restart the camera or use password login.')), 30000)
        })])
      } finally { clearTimeout(timer) }
      if (generation !== this.generation) return
      this.detector = detector
      this.lastVideoTime = -1; this.lastFrameAt = performance.now()
      const loop = () => {
        if (generation !== this.generation) return
        try {
          const now = performance.now()
          if (this.video.currentTime !== this.lastVideoTime && now - this.lastFrameAt >= 90 && this.video.readyState >= 2) {
            this.lastVideoTime = this.video.currentTime; this.lastFrameAt = now
            this.analyze(now)
          } else if (now - this.lastFrameAt > 500) {
            this.ready = false
            this.feedback(this.liveness.reset('Waiting for live camera frames. Keep the camera connected.').message, false)
          }
          this.frame = requestAnimationFrame(loop)
        } catch {
          this.stop(); this.feedback('Face detection could not run. Restart the camera or use password login.', false)
        }
      }
      loop()
    } catch (error) {
      if (generation !== this.generation) return
      this.stop(); throw error
    }
  }

  private analyze(now: number) {
    if (!this.detector || !this.video.videoWidth || !this.video.videoHeight) return false
    const scale = Math.min(1, 960 / Math.max(this.video.videoWidth, this.video.videoHeight))
    this.canvas.width = Math.round(this.video.videoWidth * scale)
    this.canvas.height = Math.round(this.video.videoHeight * scale)
    const context = this.canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height)
    this.modelTime = Math.max(now, this.modelTime + 0.01)
    const detected = this.detector.detectForVideo(this.canvas, this.modelTime)
    const observation = observationFromResult(detected, this.canvas.width, this.canvas.height)
    const bounds = detected.faceLandmarks.length === 1 ? faceBounds(detected.faceLandmarks[0]) : null
    this.crop = bounds ? faceCrop(bounds, this.canvas.width, this.canvas.height) : null
    if (bounds && !observation.issue) observation.issue = !this.crop ? 'Move a little farther away so your whole face fits.' : checkFaceQuality(this.canvas, bounds, this.sample)
    const result = this.liveness.observe(observation, now)
    this.ready = result.canCapture && this.crop !== null
    this.feedback(result.message, this.ready)
    return this.ready
  }

  capture(): number[] {
    const now = performance.now()
    if (!this.ready || now - this.lastFrameAt > 500 || !this.liveness.isFresh(now) || !this.analyze(now) || !this.crop) throw new Error('Complete the camera check with a clear, forward-facing face before capturing.')
    this.output.width = this.output.height = 32
    const context = this.output.getContext('2d', { willReadFrequently: true })!
    const { x, y, width, height } = this.crop
    context.drawImage(this.canvas, x, y, width, height, 0, 0, 32, 32)
    const data = context.getImageData(0, 0, 32, 32).data
    return Array.from({ length: 1024 }, (_, i) => (77 * data[i * 4] + 150 * data[i * 4 + 1] + 29 * data[i * 4 + 2] + 128) >> 8)
  }
}
