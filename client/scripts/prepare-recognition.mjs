import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const manifest = JSON.parse(await readFile(new URL('./recognition-checksums.json', import.meta.url), 'utf8'))
for (const [file, expected] of Object.entries(manifest.files)) {
  const data = await readFile(new URL('../public/vision/recognition/' + file, import.meta.url))
  if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error(`Recognition model checksum mismatch: ${file}`)
}
console.log('Verified local face-recognition assets.')
