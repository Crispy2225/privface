// Local, single-party development ceremony. Never represents an audited production setup.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root=fileURLToPath(new URL('../',import.meta.url)), out=resolve(root,'artifacts')
await mkdir(out,{recursive:true})
try { await access(resolve(out,'manifest.json')); throw new Error('Artifacts already exist; preserve them or explicitly remove the development artifact directory to rebuild.') }
catch (e) { if (e.code!=='ENOENT') throw e }
const run=(script,args)=>new Promise((resolve,reject)=>{
  const proc=spawn(process.execPath,[script,...args],{cwd:root,stdio:'inherit'})
  proc.on('exit',code=>code===0?resolve():reject(new Error(`Setup command failed (${code})`)))
})
const snark=resolve(root,'node_modules/snarkjs/build/cli.cjs')
await run(resolve(root,'node_modules/circom2/cli.js'),['circuits/face_match.circom','--r1cs','--wasm','--sym','--O2','--inspect','-o',out])
await run(snark,['r1cs','info',out+'/face_match.r1cs'])
// Capacity 2^15. Entropy is fresh and not written to the manifest/log.
await run(snark,['powersoftau','new','bn128','15',out+'/initial.ptau'])
await run(snark,['powersoftau','contribute',out+'/initial.ptau',out+'/contributed.ptau','--name=local-development','-e='+randomBytes(64).toString('hex')])
await run(snark,['powersoftau','prepare','phase2',out+'/contributed.ptau',out+'/final.ptau'])
await run(snark,['groth16','setup',out+'/face_match.r1cs',out+'/final.ptau',out+'/initial.zkey'])
await run(snark,['zkey','contribute',out+'/initial.zkey',out+'/face_match.zkey','--name=local-development','-e='+randomBytes(64).toString('hex')])
await run(snark,['zkey','verify',out+'/face_match.r1cs',out+'/final.ptau',out+'/face_match.zkey'])
await run(snark,['zkey','export','verificationkey',out+'/face_match.zkey',out+'/verification_key.json'])
const files={}
for (const name of ['face_match_js/face_match.wasm','face_match.zkey','verification_key.json','face_match.r1cs']) files[name]=createHash('sha256').update(await readFile(out+'/'+name)).digest('hex')
const sourceHash=createHash('sha256').update(await readFile(root+'/circuits/face_match.circom')).digest('hex')
await writeFile(out+'/manifest.json',JSON.stringify({circuit:'face-match-v1',scheme:'poseidon-int16-v1',developmentOnly:true,sourceHash,files},null,2)+'\n')
console.log('Development circuit setup complete; verification is supplementary to passkeys.')
