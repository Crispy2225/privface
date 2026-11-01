// Internal verifier adapter. expected MUST come from trusted server challenge
// state, never from a public caller. M4 owns challenge/session issuance.
import {groth16} from 'snarkjs'
import {load,acceptedContext} from './ml-common.mjs'
try{
 let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>32768)throw new Error('Oversized proof')}
 const {proof,publicSignals,expected,setupId}=JSON.parse(text)
 const a=await load()
 const valid=setupId===a.manifest.setupId&&acceptedContext(a,publicSignals,expected)&&await groth16.verify(a.vk,publicSignals,proof)
 process.stdout.write(JSON.stringify({valid:Boolean(valid)}));process.exit(0)
}catch{process.stdout.write('{"valid":false}');process.exit(0)}
