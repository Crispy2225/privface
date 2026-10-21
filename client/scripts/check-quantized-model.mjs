// Validate model loading and inference using synthetic pixels, not biometric accuracy.
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const require=createRequire(import.meta.url), api=require('face-api.js')
const directory=process.argv[2]
if (!directory) throw new Error('Provide the generated all-uint8 model directory.')
await api.tf.setBackend('cpu')
const groups=JSON.parse(await readFile(join(directory,'face_recognition_model-weights_manifest.json'),'utf8'))
let weightMap={}
for (const group of groups) {
  const bytes=Buffer.concat(await Promise.all(group.paths.map(name=>readFile(join(directory,name)))))
  const array=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
  Object.assign(weightMap,api.tf.io.decodeWeights(array,group.weights))
}
const net=new api.FaceRecognitionNet()
net.loadFromWeightMap(weightMap)
const input=api.tf.zeros([150,150,3])
const start=performance.now()
try {
  const descriptor=await net.computeFaceDescriptor(input)
  if (descriptor.length!==128 || !Array.from(descriptor).every(Number.isFinite)) throw new Error('Invalid model output')
  const result={passed:true,input:'synthetic zero-valued 150x150 RGB tensor (not a real face)',dimensions:descriptor.length,inferenceMs:performance.now()-start,biometricAccuracy:'Not evaluated'}
  console.log(JSON.stringify(result,null,2))
  if (process.argv[3]) await writeFile(process.argv[3],JSON.stringify(result,null,2)+'\n')
} finally { input.dispose(); net.dispose() }
