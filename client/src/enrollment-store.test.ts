import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteEnrollment, hasEnrollment, saveEnrollment, getEnrollment } from './enrollment-store.ts'
import { decryptTemplate, encryptTemplate } from './template-crypto.ts'

const values = Array.from({ length: 128 }, (_, index) => index / 128)
test('local enrollment persists, rejects duplicates atomically, and supports deletion', async () => {
  const record = await encryptTemplate('Alice', 'Alice', values)
  await saveEnrollment(record, new AbortController().signal)
  assert.equal(await hasEnrollment('ALICE'), true)
  assert.deepEqual(await decryptTemplate((await getEnrollment('ALICE'))!), values)
  await assert.rejects(saveEnrollment(record, new AbortController().signal), /already has/)
  await deleteEnrollment('ALICE')
  assert.equal(await hasEnrollment('alice'), false)
  assert.equal(await getEnrollment('alice'), null)
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

test('binding opening is encrypted and deleted with the local template', async () => {
  const { prepareBinding } = await import('./template-binding.ts')
  const record = await encryptTemplate('binding_user', 'Binding', values)
  await saveEnrollment(record, new AbortController().signal)
  const binding = await prepareBinding('00000000-0000-4000-8000-000000000001', record, new AbortController().signal)
  const read = () => new Promise<any>((resolve, reject) => {
    const request = indexedDB.open('privface-bindings', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('openings', 'readonly')
      const get = tx.objectStore('openings').get(binding.commitment)
      tx.oncomplete = () => { db.close(); resolve(get.result) }
    }
  })
  const stored = await read()
  assert.equal(stored.sealed.byteLength, 48)
  assert.equal(stored.blinding, undefined)
  const aad = new TextEncoder().encode(JSON.stringify([stored.accountId, record.username, binding.commitment]))
  const blind = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stored.iv, additionalData: aad }, record.key, stored.sealed))
  const { commitmentFor } = await import('./template-binding.ts')
  assert.equal(await commitmentFor(stored.accountId, values, blind), binding.commitment)
  await deleteEnrollment('binding_user')
  assert.equal(await read(), undefined)
})
