export const EMBEDDING_MODEL = 'face-api.js@0.22.2/faceRecognitionNet/128-v1'

export function canonicalUsername(username: string): string {
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) throw new Error('Use 3–32 letters, numbers, or underscores.')
  return username.toLowerCase()
}

export function validateEmbedding(values: ArrayLike<number>): number[] {
  const embedding = Array.from(values)
  if (embedding.length !== 128 || !embedding.every(Number.isFinite) || embedding.every(value => value === 0)) {
    throw new Error('The face model returned an invalid embedding. Retake your photo.')
  }
  return embedding
}

export type EncryptedTemplate = {
  username: string
  displayName: string
  model: string
  schema: 1
  createdAt: string
  key: CryptoKey
  iv: Uint8Array<ArrayBuffer>
  ciphertext: ArrayBuffer
}

function associatedData(username: string, model: string) {
  return new TextEncoder().encode(JSON.stringify(['privface-local-template', 1, username, model]))
}

export async function encryptTemplate(username: string, displayName: string, values: ArrayLike<number>): Promise<EncryptedTemplate> {
  const normalized = canonicalUsername(username)
  const embedding = validateEmbedding(values)
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(embedding))
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData(normalized, EMBEDDING_MODEL) }, key, plaintext)
    return { username: normalized, displayName, model: EMBEDDING_MODEL, schema: 1, createdAt: new Date().toISOString(), key, iv, ciphertext }
  } finally { plaintext.fill(0); embedding.fill(0) }
}

export async function decryptTemplate(record: EncryptedTemplate): Promise<number[]> {
  if (record.schema !== 1 || record.model !== EMBEDDING_MODEL || record.username !== canonicalUsername(record.username)) throw new Error('Unsupported face template.')
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv, additionalData: associatedData(record.username, record.model) }, record.key, record.ciphertext))
  try { return validateEmbedding(JSON.parse(new TextDecoder().decode(plaintext))) }
  finally { plaintext.fill(0) }
}
