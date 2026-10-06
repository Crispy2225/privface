import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export async function createFaceDetector() {
  const files = await FilesetResolver.forVisionTasks('/vision/wasm')
  return FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: '/vision/face_landmarker.task', delegate: 'CPU' },
    runningMode: 'VIDEO',
    numFaces: 2,
    minFaceDetectionConfidence: 0.65,
    minFacePresenceConfidence: 0.65,
    minTrackingConfidence: 0.65,
    outputFaceBlendshapes: true,
  })
}
