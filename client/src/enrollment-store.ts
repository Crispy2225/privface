import { canonicalUsername } from './template-crypto.ts'
import type { EncryptedTemplate } from './template-crypto.ts'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('privface-enrollment', 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore('templates', { keyPath: 'username' })
    request.onblocked = () => { blocked = true; reject(new Error('Local storage is blocked by another tab. Close other PrivFace tabs and retry.')) }
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(new Error('Local storage is unavailable. Allow site storage and try again.'))
  })
}

export async function saveEnrollment(record: EncryptedTemplate, signal: AbortSignal): Promise<void> {
  const database = await openDatabase()
  try {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('templates', 'readwrite')
      const cancel = () => transaction.abort()
      signal.addEventListener('abort', cancel, { once: true })
      // add is deliberately atomic: simultaneous tabs cannot overwrite enrollment.
      const request = transaction.objectStore('templates').add(record)
      transaction.oncomplete = () => { signal.removeEventListener('abort', cancel); resolve() }
      transaction.onabort = () => {
        signal.removeEventListener('abort', cancel)
        reject(signal.aborted ? signal.reason : new Error(request.error?.name === 'ConstraintError'
          ? 'This username already has a local enrollment. Delete it before enrolling again.'
          : 'The template could not be saved. Check available browser storage.'))
      }
    })
  } finally { database.close() }
}

export async function deleteEnrollment(username: string): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('templates', 'readwrite')
      transaction.objectStore('templates').delete(canonicalUsername(username))
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(new Error('The local enrollment could not be deleted.'))
    })
  } finally { database.close() }
}

export async function hasEnrollment(username: string): Promise<boolean> {
  const database = await openDatabase()
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = database.transaction('templates', 'readonly')
      const request = transaction.objectStore('templates').count(canonicalUsername(username))
      transaction.oncomplete = () => resolve(request.result > 0)
      transaction.onabort = () => reject(new Error('Could not read local enrollment.'))
    })
  } finally { database.close() }
}
