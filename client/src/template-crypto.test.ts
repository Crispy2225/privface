import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalUsername, decryptTemplate, encryptTemplate, validateEmbedding } from './template-crypto.ts'

const embedding = Array.from({ length: 128 }, (_, index) => (index - 60) / 128)
test('username normalization matches the account input constraints', () => {
  assert.equal(canonicalUsername('Alice_1'), 'alice_1')
  for (const name of ['aa', ' aaaa', 'alice@example.com', 'a'.repeat(33)]) assert.throws(() => canonicalUsername(name))
})
test('invalid model outputs cannot become templates', () => {
  for (const values of [[], Array(128).fill(0), Array(128).fill(NaN), Array(127).fill(1), Array(128).fill(Infinity)]) assert.throws(() => validateEmbedding(values))
})
test('template encrypts with a non-exportable key and decrypts without changing the input', async () => {
  const record = await encryptTemplate('Alice_1', 'Alice', embedding)
  assert.equal(record.key.extractable, false)
  assert.equal(record.username, 'alice_1')
  assert.deepEqual(await decryptTemplate(record), embedding)
  await assert.rejects(crypto.subtle.exportKey('raw', record.key))
})
test('ciphertext tampering and swapping the username fail authentication', async () => {
  const record = await encryptTemplate('alice', 'Alice', embedding)
  await assert.rejects(decryptTemplate({ ...record, username: 'bobby' }))
  new Uint8Array(record.ciphertext)[0] ^= 1
  await assert.rejects(decryptTemplate(record))
})
test('each enrollment uses a fresh key and IV; unknown model versions are rejected', async () => {
  const first = await encryptTemplate('alice', 'Alice', embedding)
  const second = await encryptTemplate('alice', 'Alice', embedding)
  assert.notDeepEqual(first.iv, second.iv)
  assert.notDeepEqual(first.ciphertext, second.ciphertext)
  await assert.rejects(decryptTemplate({ ...first, model: 'other-model' }))
})
