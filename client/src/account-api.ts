export type AccountSession = {
  account: { id: string; username: string; display_name: string }
  csrf: string
  authentication: 'password' | 'face-proof-demo'
  enrollment?: { commitment: string; version: number; scheme?: string } | null
  descriptor_proof?: { verified_at: number } | null
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

export function registerAccount(username:string,display_name:string,password:string,signal?:AbortSignal){
  return api<AccountSession>('/accounts/register',{username,display_name,password},undefined,signal)
}
export async function loginAccount(username:string,password:string,signal?:AbortSignal){
  const options=await api<{challenge_id:string}>('/login/options',{username},undefined,signal)
  return api<AccountSession>('/login/verify',{challenge_id:options.challenge_id,password},undefined,signal)
}
export async function authorizeBinding(binding:Record<string,string>,csrf:string,signal?:AbortSignal){
  const options=await api<{challenge_id:string}>('/enrollment/options',binding,csrf,signal)
  return api<{bound:boolean;version:number;commitment:string}>('/enrollment/verify',options,csrf,signal)
}
export async function recoverAccount(recovery_code:string,password:string,signal?:AbortSignal){
  const options=await api<{challenge_id:string}>('/recovery/options',{recovery_code},undefined,signal)
  return api<AccountSession>('/recovery/verify',{...options,password},undefined,signal)
}
export async function securityAction(action:string,password:string,csrf:string,signal?:AbortSignal){
  const options=await api<{challenge_id:string}>('/security/options',{action},csrf,signal)
  return api<{recovery_code?:string}>('/security/verify',{...options,password},csrf,signal)
}
