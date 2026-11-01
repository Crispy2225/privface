import { api } from './account-api'
import type { AccountSession } from './account-api'
import { decryptTemplate, EMBEDDING_MODEL } from './template-crypto'
import type { EncryptedTemplate } from './template-crypto'
import { QUANTIZATION } from './face-match'
import { accountField, encoded, rootFor } from './proof-math'
import type { Parameters } from './proof-math'
export type ProofConfig = { enabled: boolean; setup_id: string; assets: Record<string,string>; policy: {threshold:number; calibrated:boolean; limit:string} }
const hex=(bytes:Uint8Array)=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')
export const proofConfig=(signal?:AbortSignal)=>api<ProofConfig>('/proof/config',undefined,undefined,signal)
async function parameters(config:ProofConfig, signal?:AbortSignal):Promise<Parameters> {
  const response=await fetch('/api/proof/assets/poseidon.json',{signal})
  if(!response.ok) throw new Error('Commitment parameters unavailable')
  const bytes=await response.arrayBuffer()
  if(hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))!==config.assets['poseidon.json']) throw new Error('Commitment parameter integrity failure')
  return JSON.parse(new TextDecoder().decode(bytes))
}
type Opening={commitment:string;accountId:string;username:string;createdAt:string;iv:Uint8Array<ArrayBuffer>;sealed:ArrayBuffer}
async function openings(value:Opening|string):Promise<Opening|undefined> {
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open('privface-bindings',1)
    open.onupgradeneeded=()=>open.result.createObjectStore('openings',{keyPath:'commitment'})
    let blocked=false
    open.onblocked=()=>{blocked=true;reject(new Error('Close other PrivFace tabs and retry.'))}
    open.onerror=()=>reject(open.error)
    open.onsuccess=()=>{
      const db=open.result; if(blocked){db.close();return}; db.onversionchange=()=>db.close()
      const tx=db.transaction('openings',typeof value==='string'?'readonly':'readwrite')
      const req=typeof value==='string'?tx.objectStore('openings').get(value):tx.objectStore('openings').add(value)
      tx.oncomplete=()=>{db.close();resolve(typeof value==='string'?req.result:undefined)}
      tx.onabort=()=>{db.close();reject(tx.error || new Error('Opening storage failed'))}
    }
  })
}
export async function prepareProofBinding(accountId:string,record:EncryptedTemplate,signal:AbortSignal) {
  const config=await proofConfig(signal); if(!config.enabled) throw new Error('Descriptor proof service is disabled')
  const params=await parameters(config,signal), values=await decryptTemplate(record)
  const blind=crypto.getRandomValues(new Uint8Array(31)); if(blind.every(x=>x===0)) blind[0]=1
  const enrolled=encoded(values)
  try {
    const commitment=BigInt(rootFor(accountField(accountId),enrolled,BigInt('0x'+hex(blind)).toString(),params)).toString(16).padStart(64,'0')
    const iv=crypto.getRandomValues(new Uint8Array(12))
    const aad=new TextEncoder().encode(JSON.stringify([accountId,record.username,commitment]))
    const sealed=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},record.key,blind)
    signal.throwIfAborted()
    await openings({commitment,accountId,username:record.username,createdAt:record.createdAt,iv,sealed})
    signal.throwIfAborted()
    return {commitment,model:EMBEDDING_MODEL,quantization:QUANTIZATION,scheme:'poseidon-int16-v1'}
  } finally { values.fill(0);blind.fill(0);enrolled.fill(0) }
}
export async function proveMatch(session:AccountSession,record:EncryptedTemplate,probe:number[],signal:AbortSignal) {
  const options=await api<{challenge_id:string;commitment:string;inputs:Record<string,string>;config:ProofConfig}>('/proof/options',{},session.csrf,signal)
  const opening=await openings(options.commitment)
  if(!opening || opening.accountId!==session.account.id || opening.username!==record.username || opening.createdAt!==record.createdAt) throw new Error('Local opening is missing or outdated. Authorize this enrollment again.')
  const aad=new TextEncoder().encode(JSON.stringify([session.account.id,record.username,options.commitment]))
  const blind=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:opening.iv,additionalData:aad},record.key,opening.sealed))
  const values=await decryptTemplate(record), enrolled=encoded(values), fresh=encoded(probe)
  try {
    const blinding=BigInt('0x'+hex(blind)).toString()
    const root=rootFor(accountField(session.account.id),enrolled,blinding,await parameters(options.config,signal))
    if(root!==options.inputs.enrollmentRoot) throw new Error('Local template does not match the authorized binding')
    signal.throwIfAborted()
    const result=await new Promise<{proof:unknown;publicSignals:string[]}>((resolve,reject)=>{
      const worker=new Worker('/proof-worker.js')
      const cleanup=()=>{worker.terminate();clearTimeout(timer);signal.removeEventListener('abort',cancel)}
      const cancel=()=>{cleanup();reject(new DOMException('Proof cancelled','AbortError'))}
      const timer=setTimeout(()=>{cleanup();reject(new Error('Proof timed out; retry on this device.'))},90000)
      signal.addEventListener('abort',cancel,{once:true})
      worker.onerror=()=>{cleanup();reject(new Error('Proof worker failed'))}
      worker.onmessage=({data})=>{cleanup();data.error?reject(new Error(data.error)):resolve(data.result)}
      worker.postMessage({config:options.config,inputs:{...options.inputs,enrolled,probe:fresh,blinding}})
    })
    return await api<{verified:boolean}>('/proof/verify',{challenge_id:options.challenge_id,...result},session.csrf,signal)
  } finally {blind.fill(0);values.fill(0);enrolled.fill(0);fresh.fill(0)}
}
