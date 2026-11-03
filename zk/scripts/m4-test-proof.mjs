import {load} from './ml-common.mjs'
import {infer,commitment} from '../../client/public/zkml/runtime.mjs'
import {groth16} from 'snarkjs'
let raw='';for await(const c of process.stdin)raw+=c;const req=JSON.parse(raw),a=await load();const pixels=Array.from({length:1024},(_,i)=>(i*37+11)%256),embedding=infer(a.model,pixels),blinding='123456789123456789';
if(req.account)console.log(JSON.stringify({enrollmentRoot:commitment(req.account,a.manifest.modelTag,embedding,blinding,a.params)}));else console.log(JSON.stringify(await groth16.fullProve({...req.inputs,pixels,enrolled:embedding.map(v=>v+32768),blinding},a.loaded['zkml.wasm'],a.loaded['zkml.zkey'],undefined,undefined,{singleThread:true})));process.exit(0)
