import {loadArtifacts,makeEnrollment,inputsFor,runWorker} from './client.mjs'
import {infer,squaredDistance} from './runtime.mjs'
const el=id=>document.getElementById(id)
let artifacts,template,enrollPixels,probePixels,active,generation=0
const setStatus=text=>{el('status').textContent=text}
function buttons(){el('enroll-button').disabled=!artifacts||!enrollPixels||!!active;el('match-button').disabled=!artifacts||!template||!probePixels||!!active;el('cancel').disabled=!active}
async function readCrop(file,canvas){
 if(file.size>10*1024*1024)throw new Error('Choose an image smaller than 10 MB')
 const bitmap=await createImageBitmap(file)
 try{
  if(bitmap.width>4096||bitmap.height>4096)throw new Error('Choose an image no larger than 4096 pixels per side')
  // Browser resizing is explicitly outside the circuit. The circuit starts at
  // the resulting byte grid; x-128 and both rounded layers are constrained.
  const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,32,32)
  const image=ctx.getImageData(0,0,32,32),pixels=[]
  for(let i=0;i<image.data.length;i+=4){const gray=(77*image.data[i]+150*image.data[i+1]+29*image.data[i+2]+128)>>8;pixels.push(gray);image.data[i]=image.data[i+1]=image.data[i+2]=gray;image.data[i+3]=255}
  ctx.putImageData(image,0,0);return pixels
 }finally{bitmap.close()}
}
for(const kind of ['enroll','probe'])el(kind).addEventListener('change',async()=>{
 const version=++generation;active?.abort()
 if(kind==='enroll'){template?.embedding.fill(0);template=undefined;enrollPixels?.fill(0);enrollPixels=undefined}
 else{probePixels?.fill(0);probePixels=undefined}
 buttons()
 try{const file=el(kind).files[0];if(!file)return;const p=await readCrop(file,el(kind+'-preview'));if(version!==generation){p.fill(0);return}if(kind==='enroll'){enrollPixels?.fill(0);enrollPixels=p}else{probePixels?.fill(0);probePixels=p}setStatus('Image is ready. Processing stays in this browser.')}
 catch(e){setStatus(e.message)}finally{buttons()}
})
async function prove(operation){
 const controller=new AbortController();active=controller;buttons()
 try{
  const candidate=operation===1?makeEnrollment(artifacts,enrollPixels):template
  const pixels=operation===1?enrollPixels:probePixels
  const distance=squaredDistance(candidate.embedding,infer(artifacts.model,pixels))
  if(operation===2&&distance>Number(artifacts.policy.limit))throw new Error('The research model did not match this image. No proof generated.')
  setStatus('Generating the complete inference proof locally…')
  const result=await runWorker(artifacts,inputsFor(artifacts,candidate,pixels,operation),controller.signal)
  controller.signal.throwIfAborted()
  if(operation===1){template?.embedding.fill(0);template=candidate}
  el('result').textContent=JSON.stringify({operation:operation===1?'enrollment':'matching',verified:result.valid,provingMs:Math.round(result.provingMs),verificationMs:Math.round(result.verificationMs),proofBytes:result.proofBytes,model:artifacts.model.id,scope:'inference on a supplied aligned crop; no login session'},null,2)
  setStatus(operation===1?'Enrollment proof verified. Select a probe image.':'Matching inference proof verified. This does not create a login session.')
 }catch(e){setStatus(e.name==='AbortError'?'Proof cancelled.':e.message)}
 finally{if(active===controller)active=undefined;buttons()}
}
el('enroll-button').onclick=()=>prove(1);el('match-button').onclick=()=>prove(2);el('cancel').onclick=()=>active?.abort()
el('clear').onclick=()=>{++generation;active?.abort();enrollPixels?.fill(0);probePixels?.fill(0);template?.embedding.fill(0);template=enrollPixels=probePixels=undefined;for(const k of ['enroll','probe']){el(k).value='';el(k+'-preview').getContext('2d').clearRect(0,0,32,32)}el('result').textContent='No proof generated.';setStatus('Local session cleared.');buttons()}
document.addEventListener('visibilitychange',()=>{if(document.hidden)active?.abort()})
window.addEventListener('pagehide',()=>{active?.abort();enrollPixels?.fill(0);probePixels?.fill(0);template?.embedding.fill(0)})
try{artifacts=await loadArtifacts();setStatus('Ready. Select an aligned face crop.')}catch(e){setStatus(e.message)}buttons()
