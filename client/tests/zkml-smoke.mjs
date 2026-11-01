import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import {fileURLToPath} from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const root=fileURLToPath(new URL('../public/',import.meta.url))
const server=createServer(async(req,res)=>{
 try{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname)
  if(!path.startsWith(root)){res.writeHead(403);res.end();return}
  const b=await readFile(path)
  const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm'}[extname(path)]||'application/octet-stream'
  res.writeHead(200,{'Content-Type':type});res.end(b)
 }catch{res.writeHead(404);res.end()}
})
await new Promise(ok=>server.listen(0,'127.0.0.1',ok))
const origin='http://127.0.0.1:'+server.address().port
let browser
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
 const page=await browser.newPage(),errors=[],requests=[]
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({method:r.method(),url:r.url()}))
 await page.goto(origin+'/zkml.html')
 await page.getByRole('status').filter({hasText:'Ready.'}).waitFor()
 const report=await page.evaluate(async()=>{
  const c=await import('/zkml/client.mjs'),r=await import('/zkml/runtime.mjs')
  const a=await c.loadArtifacts(),pixels=Array.from({length:1024},(_,i)=>(i*37+11)%256)
  const template=c.makeEnrollment(a,pixels)
  const results=[]
  for(const operation of [1,2]){
   const input=c.inputsFor(a,template,pixels,operation)
   const result=await c.runWorker(a,input,new AbortController().signal)
   if(!result.valid||!r.signalsMatch(result.result.publicSignals,input,a.params))throw new Error('Proof did not match context')
   results.push({operation,provingMs:result.provingMs,verificationMs:result.verificationMs,proofBytes:result.proofBytes})
  }
  const bad=c.inputsFor(a,template,pixels,1);bad.enrolled=[...bad.enrolled];bad.enrolled[0]++
  let rejected=false;try{await c.runWorker(a,bad,new AbortController().signal)}catch{rejected=true}
  if(!rejected)throw new Error('Invalid enrollment accepted')
  const controller=new AbortController(),pending=c.runWorker(a,c.inputsFor(a,template,pixels,2),controller.signal);controller.abort()
  let cancelled=false;try{await pending}catch(e){cancelled=e.name==='AbortError'}
  if(!cancelled)throw new Error('Cancellation failed')
  let timedOut=false;try{await c.runWorker(a,c.inputsFor(a,template,pixels,2),new AbortController().signal,{timeoutMs:1})}catch(e){timedOut=e.message.includes('budget')}
  if(!timedOut)throw new Error('Timeout did not terminate worker')
  let stale=false;try{c.inputsFor(a,{...template,modelSHA256:'old'},pixels,2)}catch{stale=true}
  if(!stale)throw new Error('Legacy template accepted')
  return {results,invalidEnrollmentRejected:rejected,cancellation:cancelled,timeout:timedOut,incompatibleTemplateRejected:stale,
   modelSHA256:a.manifest.modelSHA256,setupId:a.manifest.setupId,userAgent:navigator.userAgent,
   jsHeapSnapshotBytes:performance.memory?.usedJSHeapSize??null,
   memoryNote:'JS heap snapshot is not peak WASM/worker/browser memory; M7 memory profiling pending'}
 })
 await page.route('**/zkml/model.json',route=>route.fulfill({contentType:'application/json',body:'{}'}))
 assert.equal(await page.evaluate(async()=>{try{await (await import('/zkml/client.mjs')).loadArtifacts();return false}catch(e){return e.message.includes('integrity')}}),true)
 await page.unroute('**/zkml/model.json')
 // Exercise visible upload/enrollment/probe controls with a synthetic PNG.
 const png=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=32
  const ctx=canvas.getContext('2d'),im=ctx.createImageData(32,32)
  for(let i=0;i<1024;i++){im.data[4*i]=im.data[4*i+1]=im.data[4*i+2]=(i*37+11)%256;im.data[4*i+3]=255}ctx.putImageData(im,0,0)
  return canvas.toDataURL().split(',')[1]
 })
 const image={name:'synthetic-grid.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')}
 await page.locator('#enroll').setInputFiles(image)
 await page.getByRole('button',{name:'Prove enrollment',exact:true}).click()
 await page.getByRole('status').filter({hasText:'Enrollment proof verified'}).waitFor({timeout:90000})
 await page.locator('#probe').setInputFiles(image)
 await page.getByRole('button',{name:'Prove matching inference',exact:true}).click()
 await page.getByRole('status').filter({hasText:'Matching inference proof verified'}).waitFor({timeout:90000})
 await page.setViewportSize({width:390,height:844})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 if(process.env.PRIVFACE_SCREENSHOT)await page.screenshot({path:process.env.PRIVFACE_SCREENSHOT,fullPage:true})
 await page.getByRole('button',{name:'Clear this session'}).click()
 assert.equal(await page.locator('#match-button').isDisabled(),true)
 assert.deepEqual(errors,[])
 assert(requests.every(r=>r.method==='GET'&&(r.url.startsWith(origin+'/')||r.url.startsWith('blob:'))))
 report.assetTamperingRejected=true;report.visibleEnrollmentAndMatch=true;report.clearSession=true
 report.mobileLayoutNoOverflow=true;report.noExternalOrPostRequests=true;report.browserVersion=browser.version()
 report.scope='Real headless Chromium worker proofs with synthetic crops; no physical camera or mobile-device accuracy claim'
 await writeFile(new URL('../../docs/M3-browser-experiment.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report,null,2))
}finally{await browser?.close();await new Promise(ok=>server.close(ok))}
