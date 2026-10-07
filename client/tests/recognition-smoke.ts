import { generateEmbedding } from '../src/face-embedding'
import { encryptTemplate } from '../src/template-crypto'
import { deleteEnrollment, hasEnrollment, saveEnrollment } from '../src/enrollment-store'

const result = document.querySelector('#result')!
try {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 640
  canvas.getContext('2d')!.fillRect(0, 0, 640, 640)
  try {
    await generateEmbedding(canvas.toDataURL(), new AbortController().signal)
    throw new Error('Blank frame unexpectedly accepted')
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('exactly one')) throw error
  }
  const record = await encryptTemplate('smoke_test', 'Smoke', Array.from({ length: 128 }, (_, i) => i / 128))
  await deleteEnrollment('smoke_test')
  await saveEnrollment(record, new AbortController().signal)
  if (!await hasEnrollment('SMOKE_TEST')) throw new Error('Browser persistence failed')
  await deleteEnrollment('smoke_test')
  result.textContent = 'PASS: local models loaded, blank frame rejected, browser enrollment stored and deleted.'
} catch (error) { result.textContent = 'FAIL: ' + String(error) }
