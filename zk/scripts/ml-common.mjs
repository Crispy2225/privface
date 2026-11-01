import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {validateModel,tagForHash,signalsMatch} from '../../client/public/zkml/runtime.mjs'
export const ROOT=fileURLToPath(new URL('../../',import.meta.url))
export const ARTIFACTS=resolve(ROOT,'zk/artifacts-ml')
export const hash=b=>createHash('sha256').update(b).digest('hex')
export async function load(){
 const manifest=JSON.parse(await readFile(ARTIFACTS+'/manifest.json','utf8'))
 if(manifest.format!=='privface-zkml-artifacts-v1'||manifest.developmentOnly!==true)throw new Error('Unsupported setup')
 const pub=resolve(ROOT,'client/public/zkml'),loaded={}
 for(const [name,info] of Object.entries(manifest.files)){
  if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw new Error('Invalid artifact path')
  const b=await readFile(pub+'/'+name);if(hash(b)!==info.sha256||b.length!==info.bytes)throw new Error('Artifact integrity failure: '+name)
  loaded[name]=b
 }
 for(const [path,digest] of Object.entries(manifest.sourceFiles)){
  const p=resolve(ROOT,path);if(!p.startsWith(ROOT)||hash(await readFile(p))!==digest)throw new Error('Stale circuit/source setup')
 }
 if(hash(await readFile(ARTIFACTS+'/zkml.r1cs'))!==manifest.r1csSHA256)throw new Error('R1CS mismatch')
 const json=name=>JSON.parse(loaded[name])
 const model=validateModel(json('model.json')),policy=json('policy.json')
 if(manifest.modelSHA256!==manifest.files['model.json'].sha256||policy.modelSHA256!==manifest.modelSHA256||manifest.modelTag!==tagForHash(manifest.modelSHA256)||manifest.policyTag!==tagForHash(manifest.files['policy.json'].sha256)||manifest.setupId!==manifest.files['verification_key.json'].sha256)throw new Error('Inconsistent artifact identities')
 return {manifest,model,policy,params:json('poseidon.json'),vk:json('verification_key.json'),loaded}
}
export function acceptedContext(artifacts,signals,expected){
 return expected.modelTag===artifacts.manifest.modelTag&&expected.policyTag===artifacts.manifest.policyTag&&expected.limit===artifacts.policy.limit&&signalsMatch(signals,expected,artifacts.params)
}
