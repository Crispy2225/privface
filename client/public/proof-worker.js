/* snarkjs is loaded from the server's integrity-pinned local artifact set. */
self.onmessage = async ({data}) => {
  try {
    async function asset(name) {
      const response=await fetch('/api/proof/assets/'+name)
      if(!response.ok) throw new Error('Could not load proving asset')
      const bytes=await response.arrayBuffer()
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
      if(hash!==data.config.assets[name]) throw new Error('Proving asset integrity failure')
      return bytes
    }
    const runtime=URL.createObjectURL(new Blob([await asset('snarkjs.min.js')],{type:'text/javascript'}))
    try { importScripts(runtime) } finally { URL.revokeObjectURL(runtime) }
    const wasm=new Uint8Array(await asset('face_match.wasm'))
    const zkey=new Uint8Array(await asset('face_match.zkey'))
    const result=await snarkjs.groth16.fullProve(data.inputs,wasm,zkey,undefined,undefined,{singleThread:true})
    self.postMessage({result})
  } catch(error) { self.postMessage({error:error.message || 'Proof generation failed'}) }
  finally { self.close() }
}
