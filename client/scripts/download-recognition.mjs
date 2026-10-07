// One-time maintainer download. Runtime inference never fetches remote weights.
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const revisionResponse = await fetch('https://api.github.com/repos/justadudewhohacks/face-api.js/commits/master', { headers: { 'User-Agent': 'privface-model-setup' } })
if (!revisionResponse.ok) throw new Error('Cannot resolve the model repository revision.')
const { sha } = await revisionResponse.json()
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid model revision.')
const base = `https://raw.githubusercontent.com/justadudewhohacks/face-api.js/${sha}/weights/`
const directory = new URL('../public/vision/recognition/', import.meta.url)
await mkdir(directory, { recursive: true })
const files = new Set(['tiny_face_detector_model-weights_manifest.json', 'face_landmark_68_tiny_model-weights_manifest.json', 'face_recognition_model-weights_manifest.json'])
const checksums = {}
for (const file of files) {
  const response = await fetch(base + file)
  if (!response.ok) throw new Error(`Download failed: ${file} (${response.status})`)
  const data = Buffer.from(await response.arrayBuffer())
  if (file.endsWith('.json')) for (const group of JSON.parse(data.toString())) for (const path of group.paths) files.add(path)
  checksums[file] = createHash('sha256').update(data).digest('hex')
  await writeFile(new URL(file, directory), data)
}
await writeFile(new URL('./recognition-checksums.json', import.meta.url), JSON.stringify({ source: base, files: checksums }, null, 2) + '\n')
console.log('Downloaded pretrained recognition weights and recorded SHA-256 hashes.')
