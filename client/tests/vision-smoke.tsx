// Development-only harness; excluded from the production Vite entrypoint.
// Generated pixels exercise the real model and UI without accessing a webcam.
import { createRoot } from 'react-dom/client'
import CameraCapture from '../src/CameraCapture'
import '../src/styles.css'

const canvas = document.createElement('canvas')
canvas.width = 640
canvas.height = 480
const context = canvas.getContext('2d')!
let tick = 0
const timer = setInterval(() => {
  context.fillStyle = '#182230'
  context.fillRect(0, 0, 640, 480)
  context.fillStyle = '#557699'
  context.fillRect(tick++ % 580, 430, 60, 20)
}, 60)
const streams: MediaStream[] = []
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
  value: async (constraints: MediaStreamConstraints) => {
    if (constraints.audio !== false) throw new Error('Microphone must not be requested')
    const stream = canvas.captureStream(15)
    streams.push(stream)
    return stream
  },
})
window.addEventListener('pagehide', () => { clearInterval(timer); streams.forEach(stream => stream.getTracks().forEach(track => track.stop())) })
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 520, margin: '32px auto', padding: 24 }}>
    <h1 style={{ fontSize: 28, letterSpacing: -1 }}>Synthetic camera test</h1>
    <p style={{ fontSize: 13 }}>Generated pixels only. No webcam access. The real face model must report no face and keep capture disabled.</p>
    <CameraCapture />
  </main>,
)
