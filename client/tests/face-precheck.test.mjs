import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {captureMatches,inspectCaptureMatch} from '../public/zkml/face-login.mjs'
import {infer,squaredDistance} from '../public/zkml/runtime.mjs'
const model=JSON.parse(await readFile(new URL('../public/zkml/model.json',import.meta.url)))
const pixels=Array(1024).fill(80),different=Array(1024).fill(200)
const template={embedding:infer(model,pixels)}
const distance=squaredDistance(template.embedding,infer(model,different))
assert.ok(distance>1 && distance<2**32)
test('preflight accepts identical captures and preserves the caller inputs',()=>{
 const before=JSON.stringify({pixels,template})
 assert.equal(captureMatches({model,policy:{limit:'1'}},template,pixels),true)
 assert.equal(JSON.stringify({pixels,template}),before)
})
test('preflight matches the inclusive circuit threshold exactly',()=>{
 assert.equal(captureMatches({model,policy:{limit:String(distance)}},template,different),true)
 assert.equal(captureMatches({model,policy:{limit:String(distance-1)}},template,different),false)
})
test('invalid policy fails closed',()=>{
 for(const limit of ['NaN','-1','0','4294967296']) assert.throws(()=>captureMatches({model,policy:{limit}},template,pixels))
})

test('diagnostics report the exact squared distance without biometric vectors',()=>{
 const result=inspectCaptureMatch({model,policy:{limit:String(distance-1)}},template,different)
 assert.deepEqual(result,{matched:false,distance,limit:distance-1})
})
