import { FaceLoginCamera, CAPTURE_FORMAT } from './face-login-camera'
import { cameraErrorMessage } from './camera-session'

// Public modules must load as static assets. An absolute same-origin URL
// prevents Vite dev from adding ?import and trying to transform this file.
const runtimePath = new URL('/zkml/face-login.mjs', window.location.origin).href
const { initialize } = await import(/* @vite-ignore */ runtimePath)
initialize(FaceLoginCamera, CAPTURE_FORMAT, cameraErrorMessage)
