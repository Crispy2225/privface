import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateStudy,EXPERIMENTAL_MODEL } from './study-evaluation.ts'
import {EMBEDDING_MODEL} from './template-crypto.ts'
test('paired study reports distinct model policies and excludes missing variants',()=>{
 const samples=[]
 for(const split of ['calibration','test'] as const)for(let person=0;person<4;person++)for(let session=0;session<2;session++)for(let capture=0;capture<3;capture++){
  const embedding=Array.from({length:128},(_,i)=>0.01+(i===person?0.7:0)+session*0.0001+capture*0.00001)
  samples.push({id:`${split}-${person}-${session}-${capture}`,subject:`${split}-${person}`,session:String(session),split,embedding,experimentalEmbedding:embedding.map(x=>x+0.00002),experimentalModel:EXPERIMENTAL_MODEL,baselineMs:10,experimentalMs:11})
 }
 const report=evaluateStudy({model:EMBEDDING_MODEL,samples})
 assert.equal(report.baseline.policy.model,EMBEDDING_MODEL)
 assert.equal(report.experimental?.policy.model,EXPERIMENTAL_MODEL)
 assert.equal(report.experimental?.heldOut.FAR,0)
 assert.equal(report.timing?.baselineMeanMs,10)
 assert.equal(evaluateStudy({model:EMBEDDING_MODEL,samples:samples.map(({experimentalEmbedding,...s})=>s)}).experimental,null)
})
