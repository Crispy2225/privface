import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareFaces, quantize, SCALE } from './face-match.ts'
import { commitmentFor } from './template-binding.ts'
import { evaluate } from './calibration.ts'
import { EMBEDDING_MODEL } from './template-crypto.ts'
const a = Array.from({ length: 128 }, (_, i) => (i+1) / 256)
test('quantized matcher accepts identical and nearby descriptors, rejects distant vectors', () => {
  assert.equal(compareFaces(a, a).matched, true)
  assert.equal(compareFaces(a, a.map(v => v + 0.01)).matched, true)
  assert.equal(compareFaces(a, a.map(v => v + 0.1)).matched, false)
  assert.throws(() => compareFaces(a, a, NaN))
})
test('fixed-point representation rejects clipping and invalid vectors, bounds rounding error', () => {
  assert.throws(() => quantize(a.map(() => 9)))
  assert.throws(() => quantize(a.map(() => 0.000001)))
  assert.throws(() => quantize([NaN]))
  const q = quantize(a.map(v => v+0.0001))
  q.forEach((v,i) => assert.ok(Math.abs(v / SCALE - a[i] - 0.0001) <= 0.5 / SCALE))
})
test('commitment is deterministic and binds account, descriptor, and secret blinding', async () => {
  const account = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002'
  const blind = new Uint8Array(32).fill(7)
  const c = await commitmentFor(account, a, blind)
  assert.equal(await commitmentFor(account, a, blind), c)
  assert.notEqual(await commitmentFor(other, a, blind), c)
  assert.notEqual(await commitmentFor(account, a, new Uint8Array(32).fill(8)), c)
  assert.notEqual(await commitmentFor(account, a.map(v => v+0.01), blind), c)
})
test('calibration uses held-out subjects, reports quantization drift, rejects leakage', () => {
  const samples = ['calibration','test'].flatMap((split, i) => ['a','b'].flatMap((s,j) => [1,2].map(session => ({ id: `${split}${s}${session}`, subject: `${i}${s}`, session: String(session), split: split as 'calibration' | 'test', embedding: a.map(v => v+j*0.1+session*0.001) }))))
  const report = evaluate({ model: EMBEDDING_MODEL, samples }, 0.01, 1)
  assert.equal(report.heldOut.FAR, 0); assert.equal(report.heldOut.FRR, 0)
  assert.ok(report.maxComponentError <= 0.5 / SCALE)
  samples[4].subject = samples[0].subject
  assert.throws(() => evaluate({ model: EMBEDDING_MODEL, samples }, 0.01, 1), /leakage/)
})
