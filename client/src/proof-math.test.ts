import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { poseidon,rootFor } from './proof-math.ts'
test('browser Poseidon matches circomlibjs for circuit arities and commitment',async(t)=>{
  try {await access(new URL('../../zk/artifacts/browser/poseidon.json',import.meta.url))} catch {t.skip('Prepare zk browser assets to run this integration check');return}
  const {buildPoseidon}=await import(new URL('../../zk/node_modules/circomlibjs/main.js',import.meta.url).href)
  const reference=await buildPoseidon()
  const params=JSON.parse(await readFile(new URL('../../zk/artifacts/browser/poseidon.json',import.meta.url),'utf8'))
  for(const n of [4,5,9]){const values=Array.from({length:n},(_,i)=>i+1);assert.equal(poseidon(values,params),reference.F.toObject(reference(values)).toString())}
  const {commitment}=await import(new URL('../../zk/scripts/common.mjs',import.meta.url).href)
  const values=Array.from({length:128},(_,i)=>32769+i)
  assert.equal(rootFor('123',values,'456',params),await commitment('123',values,'456'))
})
