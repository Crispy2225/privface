/* Classic worker: private pixels/witness never sent to a proving service. */
self.onmessage=async({data})=>{
 try{
  const asset=async name=>{
   const r=await fetch(new URL(name,data.assetBase));if(!r.ok)throw new Error('Missing zkML asset: '+name)
   const b=await r.arrayBuffer();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('')
   if(digest!==data.manifest.files[name]?.sha256)throw new Error('zkML asset integrity failure: '+name)
   return new Uint8Array(b)
  }
  const code=URL.createObjectURL(new Blob([await asset('snarkjs.min.js')],{type:'text/javascript'}))
  try{importScripts(code)}finally{URL.revokeObjectURL(code)}
  const vk=JSON.parse(new TextDecoder().decode(await asset('verification_key.json')))
  if(data.action==='verify'){
   const valid=await snarkjs.groth16.verify(vk,data.result.publicSignals,data.result.proof)
   self.postMessage({valid});return
  }
  const wasm=await asset('zkml.wasm'),zkey=await asset('zkml.zkey')
  const start=performance.now()
  const result=await snarkjs.groth16.fullProve(data.inputs,wasm,zkey,undefined,undefined,{singleThread:true})
  const provingMs=performance.now()-start,vs=performance.now()
  const valid=await snarkjs.groth16.verify(vk,result.publicSignals,result.proof)
  self.postMessage({result,valid,provingMs,verificationMs:performance.now()-vs,proofBytes:new TextEncoder().encode(JSON.stringify(result.proof)).length})
 }catch(e){self.postMessage({error:e.message||'zkML worker failed'})}
 finally{self.close()}
}
