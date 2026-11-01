import { groth16 } from 'snarkjs'
import { commitment } from './common.mjs'
import { readFile,writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const dir=new URL('../artifacts/',import.meta.url).pathname
const enrolled=Array.from({length:128},(_,i)=>32769+i), probe=[...enrolled]
const input={account:'1',nonce:'2',modelTag:'1',limit:'4194304',enrolled,probe,blinding:'123456789'}
input.enrollmentRoot=await commitment(input.account,enrolled,input.blinding)
const start=performance.now()
const {proof,publicSignals}=await groth16.fullProve(input,dir+'face_match_js/face_match.wasm',dir+'face_match.zkey')
const provingMs=performance.now()-start
const key=JSON.parse(await readFile(dir+'verification_key.json','utf8'))
const verifyStart=performance.now()
assert.equal(await groth16.verify(key,publicSignals,proof),true)
const verificationMs=performance.now()-verifyStart
for(const index of [1,2,3,4,5]) {const changed=[...publicSignals];changed[index]=(BigInt(changed[index])+1n).toString();assert.equal(await groth16.verify(key,changed,proof),false)}
await assert.rejects(groth16.fullProve({...input,probe:probe.map(v=>v+1000)},dir+'face_match_js/face_match.wasm',dir+'face_match.zkey'))
const report={syntheticOnly:true,validProof:true,tamperedPublicInputsRejected:true,nonMatchingWitnessRejected:true,provingMs,verificationMs,proofJsonBytes:Buffer.byteLength(JSON.stringify(proof)),scope:'Private descriptor comparison only; no ML inference or live capture. This report covers the standalone circuit; server/session integration has separate API/browser tests. Single-party development setup.'}
await writeFile(new URL('../../docs/zk-experiment.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
console.log(report)
process.exit(0)
