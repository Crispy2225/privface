export type AccountSession = {
  account: { id: string; username: string; display_name: string }
  csrf: string
  authentication: 'passkey'
  enrollment?: { commitment: string; version: number } | null
}

export async function api<T>(path: string, body?: unknown, csrf?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-Privface-Request': '1', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = 'Request failed (' + response.status + ').'
    try { const error = await response.json(); if (typeof error.detail === 'string') detail = error.detail } catch { /* retain fallback */ }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
}
export function encode(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
type Options = { challenge_id: string; publicKey: Record<string, unknown> }

export async function ceremony(options: Options, create: boolean, signal?: AbortSignal) {
  const raw = options.publicKey
  const publicKey = { ...raw, challenge: decode(raw.challenge as string) } as Record<string, unknown>
  if (create) {
    const user = raw.user as { id: string }
    publicKey.user = { ...user, id: decode(user.id) }
    publicKey.excludeCredentials = ((raw.excludeCredentials as { id: string }[]) ?? []).map(c => ({ ...c, id: decode(c.id) }))
  } else {
    publicKey.allowCredentials = ((raw.allowCredentials as { id: string }[]) ?? []).map(c => ({ ...c, id: decode(c.id) }))
  }
  const result = (create
    ? await navigator.credentials.create({ publicKey: publicKey as unknown as PublicKeyCredentialCreationOptions, signal })
    : await navigator.credentials.get({ publicKey: publicKey as unknown as PublicKeyCredentialRequestOptions, signal })) as PublicKeyCredential | null
  if (!result) throw new Error('No passkey was returned.')
  const response = result.response
  const common = { id: result.id, rawId: encode(result.rawId), type: result.type, clientExtensionResults: result.getClientExtensionResults() }
  if (create) {
    const attestation = response as AuthenticatorAttestationResponse
    return { ...common, response: { clientDataJSON: encode(response.clientDataJSON), attestationObject: encode(attestation.attestationObject), transports: attestation.getTransports?.() ?? [] } }
  }
  const assertion = response as AuthenticatorAssertionResponse
  return { ...common, response: { clientDataJSON: encode(response.clientDataJSON), authenticatorData: encode(assertion.authenticatorData), signature: encode(assertion.signature), userHandle: assertion.userHandle ? encode(assertion.userHandle) : null } }
}

export async function registerAccount(invitation: string, signal?: AbortSignal) {
  const options = await api<Options>('/accounts/options', { invitation }, undefined, signal)
  const credential = await ceremony(options, true, signal)
  return api<AccountSession>('/accounts/verify', { challenge_id: options.challenge_id, credential }, undefined, signal)
}
export async function loginAccount(username: string, signal?: AbortSignal) {
  const options = await api<Options>('/login/options', { username }, undefined, signal)
  const credential = await ceremony(options, false, signal)
  return api<AccountSession>('/login/verify', { challenge_id: options.challenge_id, credential }, undefined, signal)
}
export async function authorizeBinding(binding: Record<string, string>, csrf: string, signal?: AbortSignal) {
  const options = await api<Options>('/enrollment/options', binding, csrf, signal)
  const credential = await ceremony(options, false, signal)
  return api<{ bound: boolean; version: number; commitment: string }>('/enrollment/verify', { challenge_id: options.challenge_id, credential }, csrf, signal)
}
