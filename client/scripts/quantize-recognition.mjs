// Quantize the remaining FLOAT32 tensors; keep the baseline assets untouched.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const root = new URL('../public/vision/recognition/', import.meta.url)
const output = process.argv[2]
if (!output) throw new Error('Usage: node scripts/quantize-recognition.mjs OUTPUT_DIRECTORY')
await mkdir(output, { recursive: true })
const groups = JSON.parse(await readFile(new URL('face_recognition_model-weights_manifest.json', root), 'utf8'))
const converted = [], reports = []
for (const group of groups) {
  const source = Buffer.concat(await Promise.all(group.paths.map(file => readFile(new URL(file, root)))))
  let offset = 0
  for (const weight of group.weights) {
    const size = weight.shape.reduce((a,b) => a*b, 1)
    if (weight.quantization?.dtype === 'uint8') {
      converted.push(source.subarray(offset, offset+size)); offset += size
    } else if (weight.dtype === 'float32' && !weight.quantization) {
      const values = Array.from({ length: size }, (_, i) => source.readFloatLE(offset + i*4))
      if (!values.every(Number.isFinite)) throw new Error('Non-finite weight')
      let min=Infinity, max=-Infinity
      for (const v of values) { min=Math.min(min,v); max=Math.max(max,v) }
      const scale = max === min ? 1 : (max-min)/255
      const bytes = Buffer.alloc(size)
      let maxError=0, sumError=0
      values.forEach((v,i) => { bytes[i]=Math.max(0,Math.min(255,Math.round((v-min)/scale))); const error=bytes[i]*scale+min-v; maxError=Math.max(maxError,Math.abs(error)); sumError+=error*error })
      weight.quantization = { dtype:'uint8', min, scale }
      reports.push({ tensor:weight.name, parameters:size, maxError, rmse:Math.sqrt(sumError/size) })
      converted.push(bytes); offset+=size*4
    } else throw new Error('Unsupported source tensor')
  }
  if (offset !== source.length) throw new Error('Source shard length mismatch')
}
const bytes=Buffer.concat(converted)
await writeFile(join(output,'face_recognition_model-shard1'),bytes)
await writeFile(join(output,'face_recognition_model-weights_manifest.json'),JSON.stringify([{ weights:groups.flatMap(g=>g.weights), paths:['face_recognition_model-shard1'] }]))
for (const file of ['tiny_face_detector_model-weights_manifest.json','tiny_face_detector_model-shard1','face_landmark_68_tiny_model-weights_manifest.json','face_landmark_68_tiny_model-shard1','ATTRIBUTION.txt']) await copyFile(new URL(file,root),join(output,file))
const report={format:'all-uint8-storage-v1',sha256:createHash('sha256').update(bytes).digest('hex'),storedBytes:bytes.length,convertedTensors:reports,inference:'float32 after loading; not integer-only inference',accuracy:'Not evaluated; do not replace enrolled baseline model without a new model ID, calibration, and re-enrollment.'}
await writeFile(join(output,'quantization-report.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
