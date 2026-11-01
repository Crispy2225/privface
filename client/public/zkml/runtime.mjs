// Shared browser/Node integer reference. No floating-point model inference.
export const FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617n
export const PUBLIC=['account','nonce','enrollmentRoot','bindingVersion','operation','limit','modelTag','policyTag']
export const DOMAIN=2026110101
export function decimal(value,bits=254,nonzero=false){
  if(typeof value!=='string'||! /^(0|[1-9][0-9]{0,76})$/.test(value))throw new Error('Noncanonical field')
  const v=BigInt(value)
  if(v>=FIELD||v>=2n**BigInt(bits)||(nonzero&&v===0n))throw new Error('Field out of range')
  return value
}
export function validateModel(m){
  if(m.format!=='privface-mlp-int-v1'||m.inputSize!==1024||m.hiddenSize!==32||m.embeddingSize!==16||m.weightScale!==256||m.activationScale!==128)throw new Error('Unsupported model')
  const vector=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(x=>Number.isSafeInteger(x)&&Math.abs(x)<2**30)
  if(!Array.isArray(m.w1)||m.w1.length!==32||!m.w1.every(a=>vector(a,1024))||!vector(m.b1,32)||!Array.isArray(m.w2)||m.w2.length!==16||!m.w2.every(a=>vector(a,32))||!vector(m.b2,16))throw new Error('Malformed model')
  const h=m.w1.map((w,i)=>Math.floor((128*w.reduce((s,x)=>s+Math.abs(x),0)+Math.abs(m.b1[i])+128)/256))
  if(h.some(x=>x>=65536))throw new Error('Hidden bound exceeded')
  const b=m.w2.map((w,i)=>w.reduce((s,x,j)=>s+Math.abs(x)*h[j],Math.abs(m.b2[i])))
  if(b.some(x=>x+128>=2**31||Math.floor((x+128)/256)>=32768))throw new Error('Output bound exceeded')
  return m
}
export function infer(model,pixels){
  if(!Array.isArray(pixels)||pixels.length!==1024||pixels.some(x=>!Number.isInteger(x)||x<0||x>255))throw new Error('Expected 1024 unsigned byte pixels')
  const centered=pixels.map(x=>x-128)
  const h=model.w1.map((w,i)=>Math.max(0,Math.floor((w.reduce((sum,x,j)=>sum+x*centered[j],model.b1[i])+128)/256)))
  const embedding=model.w2.map((w,i)=>Math.floor((w.reduce((sum,x,j)=>sum+x*h[j],model.b2[i])+128)/256))
  if(h.some(x=>x>65535)||embedding.some(x=>x< -32768||x>32767))throw new Error('Inference overflow')
  return embedding
}
export function squaredDistance(a,b){
  if(a.length!==16||b.length!==16||[...a,...b].some(x=>!Number.isInteger(x)||x< -32768||x>32767))throw new Error('Invalid embedding')
  return a.reduce((sum,x,i)=>sum+(x-b[i])**2,0)
}
export function poseidon(inputs,params){
  const p=params[inputs.length];if(!p)throw new Error('Unsupported Poseidon arity')
  let state=[0n,...inputs.map(BigInt)]
  const pow5=x=>{const s=x*x%FIELD;return s*s%FIELD*x%FIELD}
  for(let r=0;r<8+p.partial;r++){
    state=state.map((x,i)=>(x+BigInt(p.C[r*state.length+i]))%FIELD)
    state=state.map((x,i)=>r<4||r>=4+p.partial||i===0?pow5(x):x)
    state=p.M.map(row=>row.reduce((s,m,i)=>(s+BigInt(m)*state[i])%FIELD,0n))
  }
  return state[0].toString()
}
export function commitment(account,modelTag,embedding,blinding,params){
  decimal(account,128,true);decimal(modelTag);decimal(blinding,248,true)
  squaredDistance(embedding,embedding)
  if(embedding.every(x=>x===0))throw new Error('Zero template')
  let root=poseidon([DOMAIN,account,modelTag,blinding],params)
  for(let i=0;i<16;i+=8)root=poseidon([root,...embedding.slice(i,i+8).map(x=>x+32768)],params)
  return root
}
export function validateContext(c){
  decimal(c.account,128,true);decimal(c.nonce,248,true);decimal(c.enrollmentRoot,254,true)
  decimal(c.bindingVersion,32,true);decimal(c.operation,2,true);decimal(c.limit,32,true)
  decimal(c.modelTag);decimal(c.policyTag)
  if(c.operation!=='1'&&c.operation!=='2')throw new Error('Unknown operation')
  return c
}
export function expectedSignals(c,params){
  validateContext(c)
  return [poseidon([DOMAIN,...PUBLIC.map(k=>c[k])],params),...PUBLIC.map(k=>c[k])]
}
export function signalsMatch(signals,c,params){
  try{return Array.isArray(signals)&&signals.length===9&&signals.every((v,i)=>decimal(v)===expectedSignals(c,params)[i])}catch{return false}
}
export const tagForHash=hash=>(BigInt('0x'+hash)%FIELD).toString()
export const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')
export const sha256=async bytes=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
