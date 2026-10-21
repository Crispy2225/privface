import { EMBEDDING_MODEL, decryptTemplate } from './template-crypto.ts'
import type { EncryptedTemplate } from './template-crypto.ts'
import { quantize, QUANTIZATION } from './face-match.ts'

export const COMMITMENT_SCHEME = 'sha256-blinded-v1'
function hex(bytes: Uint8Array) { return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('') }

export async function commitmentFor(accountId: string, values: ArrayLike<number>, blinding: Uint8Array) {
  if (!/^[0-9a-f-]{36}$/.test(accountId) || blinding.length !== 32) throw new Error('Invalid commitment context.')
  const quantized = quantize(values)
  const encoded = new TextEncoder().encode(JSON.stringify(['privface-enrollment', COMMITMENT_SCHEME, accountId, EMBEDDING_MODEL, QUANTIZATION, Array.from(quantized), hex(blinding)]))
  try { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))) }
  finally { quantized.fill(0); encoded.fill(0) }
}

// Stored separately so schema-1 encrypted enrollments remain readable.
// Each commitment keeps its encrypted opening before the remote authorization begins.
export async function prepareBinding(accountId: string, record: EncryptedTemplate, signal: AbortSignal) {
  const values = await decryptTemplate(record)
  const blind = crypto.getRandomValues(new Uint8Array(32))
  try {
    const commitment = await commitmentFor(accountId, values, blind)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const aad = new TextEncoder().encode(JSON.stringify([accountId, record.username, commitment]))
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, record.key, blind)
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('privface-bindings', 1)
      open.onupgradeneeded = () => open.result.createObjectStore('openings', { keyPath: 'commitment' })
      open.onerror = () => reject(new Error('Could not retain the private commitment opening.'))
      let blocked = false
      open.onblocked = () => { blocked = true; reject(new Error('Close other PrivFace tabs and retry binding.')) }
      open.onsuccess = () => {
        const db = open.result
        if (blocked || signal.aborted) { db.close(); reject(new Error('Binding cancelled.')); return }
        db.onversionchange = () => db.close()
        const tx = db.transaction('openings', 'readwrite')
        const cancel = () => tx.abort()
        signal.addEventListener('abort', cancel, { once: true })
        tx.objectStore('openings').add({ commitment, accountId, username: record.username, iv, sealed, createdAt: record.createdAt })
        tx.oncomplete = () => { signal.removeEventListener('abort', cancel); db.close(); resolve() }
        tx.onabort = () => { signal.removeEventListener('abort', cancel); db.close(); reject(new Error('Commitment storage failed.')) }
      }
    })
    return { commitment, model: EMBEDDING_MODEL, quantization: QUANTIZATION, scheme: COMMITMENT_SCHEME }
  } finally { values.fill(0); blind.fill(0) }
}
