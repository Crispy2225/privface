import {groth16} from 'snarkjs'
import {readFile} from 'node:fs/promises'
let text=''
for await (const chunk of process.stdin) {text+=chunk;if(text.length>32768)process.exit(2)}
try {
 const {proof,publicSignals}=JSON.parse(text)
 const key=JSON.parse(await readFile(process.argv[2],'utf8'))
 const valid=await groth16.verify(key,publicSignals,proof,undefined,{singleThread:true})
 process.stdout.write(JSON.stringify({valid}));process.exit(0)
} catch {process.stdout.write('{"valid":false}');process.exit(0)}
