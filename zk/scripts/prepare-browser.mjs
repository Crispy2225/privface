import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import constants from '../node_modules/circomlibjs/src/poseidon_constants.js'
const out=new URL('../artifacts/browser/',import.meta.url)
await mkdir(out,{recursive:true})
const params={}
for(const n of [4,5,9]) params[n]={C:constants.C[n-1],M:constants.M[n-1],partial:[56,57,56,60,60,63,64,63,60][n-1]}
await writeFile(new URL('poseidon.json',out),JSON.stringify(params))
await copyFile(new URL('../node_modules/snarkjs/build/snarkjs.min.js',import.meta.url),new URL('snarkjs.min.js',out))
await copyFile(new URL('../node_modules/snarkjs/COPYING',import.meta.url),new URL('SNARKJS-LICENSE.txt',out))
const mapping={'face_match.wasm':'face_match_js/face_match.wasm','face_match.zkey':'face_match.zkey','snarkjs.min.js':'browser/snarkjs.min.js','poseidon.json':'browser/poseidon.json','SNARKJS-LICENSE.txt':'browser/SNARKJS-LICENSE.txt'}
const files={}
for(const [name,path] of Object.entries(mapping)) files[name]={path,sha256:createHash('sha256').update(await readFile(new URL('../artifacts/'+path,import.meta.url))).digest('hex')}
await writeFile(new URL('../artifacts/browser-manifest.json',import.meta.url),JSON.stringify(files,null,2)+'\n')
console.log('Prepared same-origin browser proving assets.')
