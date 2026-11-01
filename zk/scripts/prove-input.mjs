// Private input is read from stdin, never argv/logs. Intended for integration tests.
import {groth16} from 'snarkjs'
let text='';for await(const chunk of process.stdin)text+=chunk
const input=JSON.parse(text)
const dir=new URL('../artifacts/',import.meta.url).pathname
const result=await groth16.fullProve(input,dir+'face_match_js/face_match.wasm',dir+'face_match.zkey',undefined,undefined,{singleThread:true})
process.stdout.write(JSON.stringify(result));process.exit(0)
