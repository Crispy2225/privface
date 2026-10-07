import { validateEmbedding } from './template-crypto'

let loading: Promise<typeof import('face-api.js')> | null = null

function loadRecognitionModel() {
  loading ??= import('face-api.js').then(async api => {
    // CPU avoids GPU capability differences. All weights are same-origin assets.
    await api.tf.setBackend('cpu')
    await Promise.all([
      api.nets.tinyFaceDetector.loadFromUri('/vision/recognition'),
      api.nets.faceLandmark68TinyNet.loadFromUri('/vision/recognition'),
      api.nets.faceRecognitionNet.loadFromUri('/vision/recognition'),
    ])
    return api
  }).catch(error => { loading = null; throw error })
  return loading
}

export async function generateEmbedding(photo: string, signal: AbortSignal): Promise<number[]> {
  const api = await loadRecognitionModel().catch(() => { throw new Error('The local recognition model could not load. Reload the page and try again; check that its model assets are available.') })
  signal.throwIfAborted()
  const image = new Image()
  image.src = photo
  await image.decode()
  try {
    signal.throwIfAborted()
    const faces = await api.detectAllFaces(image, new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.65 }))
      .withFaceLandmarks(true).withFaceDescriptors()
    signal.throwIfAborted()
    if (faces.length !== 1) throw new Error('Embedding requires exactly one clear face. Retake your photo in good lighting.')
    return validateEmbedding(faces[0].descriptor)
  } finally { image.src = '' }
}
