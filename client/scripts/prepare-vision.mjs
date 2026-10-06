import { cp, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const model = new URL('public/vision/face_landmarker.task', root)
const expected = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'
const actual = createHash('sha256').update(await readFile(model)).digest('hex')
if (actual !== expected) throw new Error('Face model checksum mismatch. Restore the checked-in public/vision/face_landmarker.task.')
const target = new URL('public/vision/wasm/', root)
await mkdir(target, { recursive: true })
await cp(fileURLToPath(new URL('node_modules/@mediapipe/tasks-vision/wasm/', root)), fileURLToPath(target), { recursive: true })
console.log('Verified face model and prepared local MediaPipe runtime.')
