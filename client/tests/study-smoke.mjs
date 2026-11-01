const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
import assert from 'node:assert/strict'
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
try{
 const page=await browser.newPage();const errors=[],posts=[]
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(r.url())})
 await page.goto((process.env.PRIVFACE_URL || 'http://localhost:5173')+'/study')
 await page.getByRole('heading',{name:'Collect calibration samples'}).waitFor()
 const samples=[]
 for(const split of ['calibration','test'])for(let person=0;person<4;person++)for(let session=0;session<2;session++)for(let capture=0;capture<3;capture++){
 const embedding=Array.from({length:128},(_,i)=>0.01+(i===person?0.7:0)+session*0.0001+capture*0.00001)
 samples.push({id:`${split}-${person}-${session}-${capture}`,subject:`${split}-${person}`,session:String(session),split,embedding,experimentalEmbedding:embedding.map(x=>x+0.00002),experimentalModel:'face-api.js@0.22.2/faceRecognitionNet/all-uint8-storage-v1',baselineMs:10,experimentalMs:11})
 }
 await page.getByLabel('Import a previously exported dataset').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({model:'face-api.js@0.22.2/faceRecognitionNet/128-v1',samples}))})
 await page.getByText('48 samples held in this page.',{exact:false}).waitFor()
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Evaluate and export report'}).click();assert.equal((await download).suggestedFilename(),'privface-calibration-report.json')
 await page.getByText('The active policy has NOT been changed.',{exact:false}).waitFor()
 const blank=await page.evaluate(async()=>{
 const {generateStudyEmbedding}=await import('/src/face-embedding.ts')
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480
 try{await generateStudyEmbedding(canvas.toDataURL(),new AbortController().signal);return 'unexpected acceptance'}catch(e){return e.message}
 })
 assert.match(blank,/exactly one clear face/)
 await page.setViewportSize({width:390,height:844})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
 if(process.env.PRIVFACE_SCREENSHOT)await page.screenshot({path:process.env.PRIVFACE_SCREENSHOT,fullPage:true})
 await page.getByRole('button',{name:'Clear in-page samples'}).click()
 await page.getByText('0 samples held in this page.',{exact:false}).waitFor()
 assert.deepEqual(posts,[]);assert.deepEqual(errors,[])
 console.log('PASS: study import, paired report export, unchanged policy, rejection of blank image, clearing, no API POSTs, and mobile overflow check. Synthetic test data only.')
}finally{await browser.close()}
