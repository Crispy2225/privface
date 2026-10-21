import { readFile, stat, writeFile } from 'node:fs/promises'
const root = new URL('../public/vision/recognition/', import.meta.url)
const reports = []
for (const name of ['tiny_face_detector_model', 'face_landmark_68_tiny_model', 'face_recognition_model']) {
  const groups = JSON.parse(await readFile(new URL(name + '-weights_manifest.json', root), 'utf8'))
  let parameters = 0, tensors = 0, storedBytes = 0, expectedBytes = 0, quantizedParameters = 0
  for (const group of groups) {
    for (const weight of group.weights) {
      if (weight.dtype !== 'float32' || (weight.quantization && (weight.quantization.dtype !== 'uint8' || !Number.isFinite(weight.quantization.min) || !(weight.quantization.scale > 0)))) throw new Error('Unexpected quantization: ' + weight.name)
      const count = weight.shape.reduce((a,b) => a*b, 1)
      parameters += count; tensors++; expectedBytes += count * (weight.quantization ? 1 : 4)
      if (weight.quantization) quantizedParameters += count
    }
    for (const file of group.paths) storedBytes += (await stat(new URL(file, root))).size
  }
  if (storedBytes !== expectedBytes) throw new Error('Shard length differs from UINT8 manifest size')
  reports.push({ name, parameters, tensors, storedBytes, quantizedParameters, float32Parameters: parameters - quantizedParameters, equivalentFloat32Bytes: parameters * 4, storageReductionPercent: (1-storedBytes/(parameters*4))*100 })
}
const report = { models: reports, inference: 'Weights dequantize to float32 for face-api.js inference; this is not integer-only inference.', descriptor: { dimensions: 128, int16Bytes: 256, float32Bytes: 512, scale: 4096, maxComponentRoundingError: 0.5 / 4096, maxPairDistanceErrorBound: Math.sqrt(128) / 4096 } }
console.log(JSON.stringify(report, null, 2))
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n')
