import {infer,commitment,validateModel,validateContext,signalsMatch,tagForHash,sha256,hex} from './runtime.mjs'
export async function loadArtifacts(signal){
  if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname))throw new Error('Research setup is restricted to localhost')
  const response=await fetch('/zkml/manifest.json',{signal,cache:'no-store'})
  if(!response.ok)throw new Error('Run npm --prefix zk run setup:ml first')
  const manifest=await response.json()
  if(manifest.format!=='privface-zkml-artifacts-v1'||manifest.developmentOnly!==true)throw new Error('Unsupported artifact set')
  const asset=async name=>{
    const r=await fetch('/zkml/'+name,{signal});if(!r.ok)throw new Error('Missing asset '+name)
    const b=await r.arrayBuffer();if(await sha256(b)!==manifest.files[name]?.sha256)throw new Error('Artifact integrity failure: '+name)
    return b
  }
  const model=validateModel(JSON.parse(new TextDecoder().decode(await asset('model.json'))))
  const policy=JSON.parse(new TextDecoder().decode(await asset('policy.json')))
  const params=JSON.parse(new TextDecoder().decode(await asset('poseidon.json')))
  if(manifest.modelSHA256!==manifest.files['model.json'].sha256||policy.modelSHA256!==manifest.modelSHA256||manifest.modelTag!==tagForHash(manifest.modelSHA256)||manifest.policyTag!==tagForHash(manifest.files['policy.json'].sha256)||manifest.setupId!==manifest.files['verification_key.json'].sha256)throw new Error('Inconsistent model, policy or setup')
  const workerBytes=await asset('worker.js')
  return {manifest,model,policy,params,workerBytes}
}
export function randomField(bytes){
  const b=crypto.getRandomValues(new Uint8Array(bytes));if(b.every(x=>x===0))b[0]=1
  return BigInt('0x'+hex(b)).toString()
}
export function makeEnrollment(artifacts,pixels,account=randomField(16)){
  const embedding=infer(artifacts.model,pixels),blinding=randomField(31)
  return {format:'privface-zkml-template-v1',modelSHA256:artifacts.manifest.modelSHA256,
    preprocessing:artifacts.model.preprocessing,quantization:artifacts.model.quantization,
    account,embedding,blinding,bindingVersion:'1',
    enrollmentRoot:commitment(account,artifacts.manifest.modelTag,embedding,blinding,artifacts.params)}
}
export function inputsFor(artifacts,template,pixels,operation,nonce=randomField(31)){
  if(template.format!=='privface-zkml-template-v1'||template.modelSHA256!==artifacts.manifest.modelSHA256||template.preprocessing!==artifacts.model.preprocessing||template.quantization!==artifacts.model.quantization)throw new Error('Incompatible enrollment. Re-enroll with this model; legacy templates cannot be converted.')
  const context=validateContext({account:template.account,nonce,enrollmentRoot:template.enrollmentRoot,
    bindingVersion:template.bindingVersion,operation:String(operation),limit:artifacts.policy.limit,
    modelTag:artifacts.manifest.modelTag,policyTag:artifacts.manifest.policyTag})
  // The probe is NOT an input. It is derived inside the circuit from pixels.
  return {...context,pixels,enrolled:template.embedding.map(x=>x+32768),blinding:template.blinding}
}
export function runWorker(artifacts,inputs,signal,options={}){
  signal?.throwIfAborted()
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(new Blob([artifacts.workerBytes],{type:'text/javascript'}))
    const worker=new Worker(url)
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);worker.terminate();URL.revokeObjectURL(url)}
    const cancel=()=>{cleanup();reject(new DOMException('Proof cancelled','AbortError'))}
    const timer=setTimeout(()=>{cleanup();reject(new Error('Proof exceeded the 90-second research budget'))},options.timeoutMs??90000)
    signal?.addEventListener('abort',cancel,{once:true})
    worker.onerror=()=>{cleanup();reject(new Error('Proof worker failed'))}
    worker.onmessage=({data})=>{
      cleanup()
      if(data.error)return reject(new Error(data.error))
      if(!data.valid||!signalsMatch(data.result.publicSignals,inputs,artifacts.params))return reject(new Error('Proof or public context did not verify'))
      resolve(data)
    }
    worker.postMessage({manifest:artifacts.manifest,inputs,assetBase:location.origin+'/zkml/'})
  })
}
