import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {groth16,wtns} from 'snarkjs'
import {load,ROOT,ARTIFACTS,acceptedContext} from './ml-common.mjs'
import {infer,commitment,squaredDistance,PUBLIC,signalsMatch,expectedSignals,FIELD} from '../../client/public/zkml/runtime.mjs'
const a=await load(),wasm=a.loaded['zkml.wasm'],zkey=a.loaded['zkml.zkey']
const quiet={info(){},warn(){},error(){},debug(){}}
const python=process.env.PYTHON_BINARY||'python3'
const reference=spawnSync(python,[ROOT+'/zk/ml/reference.py'],{encoding:'utf8'})
if(reference.status!==0)throw new Error(reference.stderr)
const cases=JSON.parse(reference.stdout),checks=[]
const check=(name,fn)=>{fn();checks.push(name)}
for(const c of cases)check('Python/JS integer parity: '+c.name,()=>assert.deepEqual(infer(a.model,c.pixels),c.embedding))
for(const pixels of [[...cases[0].pixels.slice(1)],cases[0].pixels.map((v,i)=>i===0?256:v),cases[0].pixels.map((v,i)=>i===0?-1:v)])check('Invalid pixel input rejected',()=>assert.throws(()=>infer(a.model,pixels)))
const pixels=cases[3].pixels,embedding=infer(a.model,pixels),blinding='123456789123456789'
const context={account:'123456789',nonce:'987654321',enrollmentRoot:commitment('123456789',a.manifest.modelTag,embedding,blinding,a.params),bindingVersion:'1',operation:'1',limit:a.policy.limit,modelTag:a.manifest.modelTag,policyTag:a.manifest.policyTag}
const input={...context,pixels,enrolled:embedding.map(x=>x+32768),blinding}
const timings=[]
async function prove(label,inputs){
 const start=performance.now();const result=await groth16.fullProve(inputs,wasm,zkey,undefined,undefined,{singleThread:true})
 const provingMs=performance.now()-start,vstart=performance.now()
 assert.equal(await groth16.verify(a.vk,result.publicSignals,result.proof),true)
 assert.equal(acceptedContext(a,result.publicSignals,inputs),true)
 timings.push({label,provingMs,verificationMs:performance.now()-vstart,proofJSONBytes:Buffer.byteLength(JSON.stringify(result.proof))})
 checks.push(label);return result
}
const enrollment=await prove('Full enrollment inference proof',input)
const probe=[...pixels];probe[0]+=1
assert(squaredDistance(embedding,infer(a.model,probe))<=Number(a.policy.limit))
const loginInput={...input,operation:'2',nonce:'987654322',pixels:probe}
const login=await prove('Full login-relation inference proof with a different crop',loginInput)
// Every public signal is cryptographically bound, including the context output.
for(let i=0;i<login.publicSignals.length;i++){
 const changed=[...login.publicSignals];changed[i]=(BigInt(changed[i])+1n).toString()
 assert.equal(await groth16.verify(a.vk,changed,login.proof),false)
 checks.push('Tampered public signal rejected: '+(i?PUBLIC[i-1]:'contextTag'))
}
for(const key of PUBLIC){const c={...loginInput,[key]:(BigInt(loginInput[key])+1n).toString()};assert.equal(signalsMatch(login.publicSignals,c,a.params),false)}
checks.push('Trusted expected-context mismatch rejected for all eight inputs')
assert.equal(signalsMatch([...login.publicSignals.slice(0,-1),'0'+login.publicSignals.at(-1)],loginInput,a.params),false)
assert.equal(signalsMatch([FIELD.toString(),...login.publicSignals.slice(1)],loginInput,a.params),false)
checks.push('Noncanonical/out-of-field public signals rejected')
async function rejects(name,change){
 let failed=false
 try{const mem={type:'mem'};await wtns.calculate({...input,...change},wasm,mem);failed=!(await wtns.check(ARTIFACTS+'/zkml.r1cs',mem,quiet))}catch{failed=true}
 assert.equal(failed,true,name);checks.push(name)
}
await rejects('Out-of-range private pixel rejected',{pixels:pixels.map((v,i)=>i===0?256:v)})
await rejects('Negative private pixel rejected',{pixels:pixels.map((v,i)=>i===0?-1:v)})
await rejects('Altered embedded model identity rejected',{modelTag:(BigInt(input.modelTag)+1n).toString()})
await rejects('Unknown proof operation rejected',{operation:'3'})
await rejects('Zero blinding rejected',{blinding:'0'})
await rejects('Zero nonce rejected',{nonce:'0'})
await rejects('Oversized account rejected',{account:(2n**128n).toString()})
await rejects('Changed enrollment descriptor rejected',{enrolled:input.enrolled.map((v,i)=>v+(i===0?1:0))})
// Recompute a VALID commitment to a false descriptor. Enrollment must still fail.
const forged=embedding.map((v,i)=>v+(i===0?1:0))
await rejects('Self-consistent arbitrary enrollment commitment rejected',{
 enrolled:forged.map(x=>x+32768),enrollmentRoot:commitment(input.account,input.modelTag,forged,blinding,a.params)})
const nonmatch=cases.find(c=>squaredDistance(embedding,c.embedding)>Number(a.policy.limit))
assert(nonmatch,'Need a nonmatching test image')
await rejects('Old template cannot replace inference for nonmatching pixels',{operation:'2',pixels:nonmatch.pixels})
// Check every Python oracle image against the actual R1CS, not only the JS code.
for(const c of cases){
 const root=commitment(input.account,input.modelTag,c.embedding,blinding,a.params)
 const mem={type:'mem'};await wtns.calculate({...input,pixels:c.pixels,enrolled:c.embedding.map(x=>x+32768),enrollmentRoot:root},wasm,mem)
 assert.equal(await wtns.check(ARTIFACTS+'/zkml.r1cs',mem,quiet),true)
 checks.push('Python/Circom parity: '+c.name)
}
// Bypass the honest witness calculator: corrupt a retained intermediate wire.
// A sound circuit must reject it independently of JavaScript validation.
const malicious={type:'mem'};await wtns.calculate(input,wasm,malicious)
const symbol=(await readFile(ARTIFACTS+'/zkml.sym','utf8')).split('\n').find(s=>s.endsWith(',main.inference.hidden[0].value'))
const wire=Number(symbol.split(',')[1]);assert(wire>0)
const buffer=Buffer.from(malicious.data);assert.equal(buffer.toString('ascii',0,4),'wtns')
let offset=12,fieldBytes,section2
for(let i=0;i<buffer.readUInt32LE(8);i++){
 const type=buffer.readUInt32LE(offset),size=Number(buffer.readBigUInt64LE(offset+4));offset+=12
 if(type===1)fieldBytes=buffer.readUInt32LE(offset)
 if(type===2)section2=offset
 offset+=size
}
assert.equal(fieldBytes,32);assert(section2)
buffer[section2+wire*fieldBytes]^=1
assert.equal(await wtns.check(ARTIFACTS+'/zkml.r1cs',{type:'mem',data:new Uint8Array(buffer)},quiet),false)
checks.push('Malicious intermediate witness rejected by R1CS (calculator bypassed)')
// The adapter consumes proofs/public inputs only. No pixels or template uploaded.
const payload={proof:login.proof,publicSignals:login.publicSignals,expected:Object.fromEntries(PUBLIC.map(k=>[k,loginInput[k]])),setupId:a.manifest.setupId}
const verify=p=>JSON.parse(spawnSync(process.execPath,[ROOT+'/zk/scripts/verify-ml.mjs'],{input:JSON.stringify(p),encoding:'utf8'}).stdout).valid
assert.equal(verify(payload),true);assert.equal(verify({...payload,setupId:'retired'}),false)
assert.equal(verify({...payload,proof:{}}),false)
assert.equal(verify({...payload,expected:{...payload.expected,limit:String(Number(a.policy.limit)+1)}}),false)
checks.push('Pinned verifier accepts valid proof; rejects malformed proof, retired setup, altered threshold')
await writeFile(ARTIFACTS+'/test-proof.json',JSON.stringify(payload))
const report={scope:'M2/M3 full small-MLP inference on synthetic image grids; not camera/accuracy evidence',
 node:process.version,platform:process.platform,architecture:process.arch,setupId:a.manifest.setupId,
 modelSHA256:a.manifest.modelSHA256,checks,timings,peakRSSBytes:process.resourceUsage().maxRSS*1024,
 assets:Object.fromEntries(Object.entries(a.manifest.files).map(([k,v])=>[k,v.bytes]))}
await writeFile(ROOT+'/docs/M3-proof-experiment.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2));process.exit(0)
