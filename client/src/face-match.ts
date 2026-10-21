import { validateEmbedding } from './template-crypto.ts'

export const QUANTIZATION = 'int16-s4096-v1'
export const SCALE = 4096
export const DEFAULT_THRESHOLD = 0.5 // Provisional demo setting, NOT a measured biometric threshold.

export function quantize(values: ArrayLike<number>): Int16Array {
  const embedding = validateEmbedding(values)
  const result = new Int16Array(128)
  for (let i = 0; i < 128; i++) {
    const rounded = Math.round(embedding[i] * SCALE)
    if (rounded < -32768 || rounded > 32767) throw new Error('Descriptor exceeds the quantization range; no clipping is allowed.')
    result[i] = rounded
  }
  if (result.every(value => value === 0)) throw new Error('Descriptor becomes zero after quantization.')
  return result
}

export function squaredDistance(a: Int16Array, b: Int16Array): number {
  if (a.length !== 128 || b.length !== 128) throw new Error('Expected 128 quantized values.')
  let sum = 0
  for (let i = 0; i < 128; i++) sum += (a[i] - b[i]) ** 2
  return sum // Maximum < 2^40: exactly representable as a JavaScript integer.
}

export function compareFaces(enrolled: ArrayLike<number>, probe: ArrayLike<number>, threshold = DEFAULT_THRESHOLD) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 2) throw new Error('Invalid matching threshold.')
  const a = quantize(enrolled), b = quantize(probe)
  try {
    const squared = squaredDistance(a, b)
    return { matched: squared <= Math.floor((threshold * SCALE) ** 2), distance: Math.sqrt(squared) / SCALE, threshold, squared }
  } finally { a.fill(0); b.fill(0) }
}
