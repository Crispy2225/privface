import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteEnrollment, hasEnrollment, saveEnrollment } from './enrollment-store.ts'
import { decryptTemplate, encryptTemplate } from './template-crypto.ts'

const values = Array.from({ length: 128 }, (_, index) => index / 128)
test('local enrollment persists, rejects duplicates atomically, and supports deletion', async () => {
  const record = await encryptTemplate('Alice', 'Alice', values)
  await saveEnrollment(record, new AbortController().signal)
  assert.equal(await hasEnrollment('ALICE'), true)
  await assert.rejects(saveEnrollment(record, new AbortController().signal), /already has/)
  await deleteEnrollment('ALICE')
  assert.equal(await hasEnrollment('alice'), false)
})
test('concurrent tabs cannot overwrite a username', async () => {
  const record = await encryptTemplate('bobby', 'Bob', values)
  const results = await Promise.allSettled([saveEnrollment(record, new AbortController().signal), saveEnrollment(record, new AbortController().signal)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  await deleteEnrollment('bobby')
})
test('cancelled enrollment never writes a record', async () => {
  const record = await encryptTemplate('carol', 'Carol', values)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(saveEnrollment(record, controller.signal))
  assert.equal(await hasEnrollment('carol'), false)
})
test('IndexedDB structured-clones encryption keys and ciphertext for later decryption', async () => {
  const record = await encryptTemplate('david', 'David', values)
  await saveEnrollment(record, new AbortController().signal)
  const stored = await new Promise<typeof record>((resolve, reject) => {
    const open = indexedDB.open('privface-enrollment', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const transaction = db.transaction('templates', 'readonly')
      const request = transaction.objectStore('templates').get('david')
      transaction.oncomplete = () => { db.close(); resolve(request.result) }
    }
  })
  assert.deepEqual(await decryptTemplate(stored), values)
  await deleteEnrollment('david')
})
