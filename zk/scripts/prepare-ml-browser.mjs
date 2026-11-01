// Refresh browser glue hashes without changing the circuit or trusted setup.
import {readFile,writeFile} from 'node:fs/promises'
import {ROOT,ARTIFACTS,hash} from './ml-common.mjs'
const manifest=JSON.parse(await readFile(ARTIFACTS+'/manifest.json','utf8'))
for(const path of ['zk/circuits/zkml.circom','zk/generated/model.circom']){
 if(hash(await readFile(ROOT+'/'+path))!==manifest.sourceFiles[path])throw new Error('Circuit changed; new setup required')
}
for(const [name,info] of Object.entries(manifest.files)){
 if(['worker.js','runtime.mjs'].includes(name))continue
 if(hash(await readFile(ROOT+'/client/public/zkml/'+name))!==info.sha256)throw new Error('Model/proving asset changed; new setup required')
}
for(const name of ['worker.js','runtime.mjs']){
 const b=await readFile(ROOT+'/client/public/zkml/'+name)
 manifest.files[name]={sha256:hash(b),bytes:b.length};manifest.sourceFiles['client/public/zkml/'+name]=hash(b)
}
await writeFile(ARTIFACTS+'/manifest.json',JSON.stringify(manifest,null,2)+'\n')
await writeFile(ROOT+'/client/public/zkml/manifest.json',JSON.stringify(manifest,null,2)+'\n')
console.log('Browser glue refreshed; model, circuit and verification key unchanged.')
