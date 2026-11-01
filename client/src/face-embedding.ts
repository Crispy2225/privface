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

export const EXPERIMENTAL_MODEL = 'face-api.js@0.22.2/faceRecognitionNet/all-uint8-storage-v1'
let experimental: Promise<import('face-api.js').FaceRecognitionNet> | null = null
// Study-only comparison. Both models see the same aligned crop; neither replaces
// the enrolled baseline, and both execute floating-point inference after loading.
export async function generateStudyEmbedding(photo:string,signal:AbortSignal) {
  const api=await loadRecognitionModel()
  experimental ??= (async()=>{const net=new api.FaceRecognitionNet();await net.loadFromUri('/vision/recognition-int8');return net})().catch(error=>{experimental=null;throw error})
  const candidate=await experimental
  signal.throwIfAborted()
  const image=new Image();image.src=photo;await image.decode()
  let crop:HTMLCanvasElement|undefined
  try {
    const faces=await api.detectAllFaces(image,new api.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:0.65})).withFaceLandmarks(true)
    if(faces.length!==1)throw new Error('Study extraction requires exactly one clear face')
    ;[crop]=await api.extractFaces(image,[faces[0].landmarks.align(undefined,{useDlibAlignment:true})])
    signal.throwIfAborted()
    // Alternate order to reduce systematic first-model timing bias.
    const order=crypto.getRandomValues(new Uint8Array(1))[0]%2
    let baseline:number[]=[],variant:number[]=[],baselineMs=0,variantMs=0
    for(const which of (order?[1,0]:[0,1])){
      const start=performance.now()
      const value=validateEmbedding(await (which?candidate:api.nets.faceRecognitionNet).computeFaceDescriptor(crop) as Float32Array)
      if(which){variant=value;variantMs=performance.now()-start}else{baseline=value;baselineMs=performance.now()-start}
      signal.throwIfAborted()
    }
    return {embedding:baseline,experimentalEmbedding:variant,baselineMs,experimentalMs:variantMs,experimentalModel:EXPERIMENTAL_MODEL}
  } finally {image.src='';if(crop){crop.width=0;crop.height=0}}
}
