import { FaceLoginCamera, CAPTURE_FORMAT } from './face-login-camera'
import { cameraErrorMessage } from './camera-session'

const runtimePath = '/zkml/face-login.mjs'
const { initialize } = await import(/* @vite-ignore */ runtimePath)
initialize(FaceLoginCamera, CAPTURE_FORMAT, cameraErrorMessage)
