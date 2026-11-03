// Repeated local Chromium proofs with sampled whole-browser process-tree RSS.
// RSS sums may double-count shared pages; 50 ms sampling may miss short peaks.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile, writeFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {resolve, extname, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import os from 'node:os'
const run = promisify(execFile)
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../public/', import.meta.url))
const samples = Number(process.env.ZKML_BENCHMARK_RUNS || 20)
assert(Number.isInteger(samples) && samples >= 20 && samples <= 1000)
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname)
    if (!path.startsWith(resolve(root) + sep)) { res.writeHead(403); res.end(); return }
    const b = await readFile(path)
    res.writeHead(200, {'Content-Type': {'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'}[extname(path)] || 'application/octet-stream'})
    res.end(b)
  } catch { res.writeHead(404); res.end() }
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
let browser, timer, sampling = false, peak = 0, observations = 0, memoryError = null
try {
  browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})})
  const cdp = await browser.newBrowserCDPSession()
  const info = await cdp.send('SystemInfo.getProcessInfo')
  const pid = info.processInfo.find(p => p.type === 'browser')?.id
  assert(pid, 'Browser PID unavailable')
  const sample = async () => {
    if (sampling) return
    sampling = true
    try {
      const {stdout} = await run('ps', ['-axo', 'pid=,ppid=,rss='])
      const rows = stdout.trim().split('\n').map(s => s.trim().split(/\s+/).map(Number))
      const family = new Set([pid])
      let added
      do { added=false; for (const [id,parent] of rows) if (family.has(parent) && !family.has(id)) {family.add(id); added=true} } while (added)
      const total = rows.filter(([id]) => family.has(id)).reduce((n,r) => n+r[2]*1024, 0)
      assert(total > 0)
      peak = Math.max(peak, total); observations++
    } catch(e) { memoryError = e.message } finally { sampling = false }
  }
  await sample(); timer = setInterval(sample, 50)
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:' + server.address().port + '/zkml.html')
  const measurements = await page.evaluate(async count => {
    const c = await import('/zkml/client.mjs'), r = await import('/zkml/runtime.mjs')
    const a = await c.loadArtifacts(), pixels = Array.from({length:1024}, (_,i)=>(i*37+11)%256)
    const template = c.makeEnrollment(a, pixels), timings = []
    for (let i=0; i<count; i++) {
      const input = c.inputsFor(a, template, pixels, 2), start = performance.now()
      const result = await c.runWorker(a, input, new AbortController().signal)
      if (!result.valid || !r.signalsMatch(result.result.publicSignals, input, a.params)) throw Error('Proof verification failed')
      timings.push({provingMs:result.provingMs, verificationMs:result.verificationMs, endToEndMs:performance.now()-start})
    }
    return {modelSHA256:a.manifest.modelSHA256, setupId:a.manifest.setupId, timings, userAgent:navigator.userAgent}
  }, samples)
  clearInterval(timer); await sample()
  while (sampling) await new Promise(ok=>setTimeout(ok,10))
  assert.equal(memoryError, null, 'Memory sampling failed')
  const percentile = values => [...values].sort((a,b)=>a-b)[Math.ceil(.95*values.length)-1]
  const report = {...measurements, scope:'Synthetic matching proofs, new worker per run; not recognition accuracy or physical-phone evidence',
    device:{platform:os.platform(), architecture:os.arch(), cpu:os.cpus()[0]?.model, logicalCPUs:os.cpus().length, totalMemoryBytes:os.totalmem()},
    runs:samples, p95ProvingMs:percentile(measurements.timings.map(t=>t.provingMs)),
    p95EndToEndMs:percentile(measurements.timings.map(t=>t.endToEndMs)),
    memory:{sampledPeakBrowserTreeRSSBytes:peak, observations, intervalMs:50,
      scope:'Entire dedicated browser process tree including renderers and workers; shared pages may be double-counted; sampling may miss short peaks'},
    provisionalBudget:{target:'16 GiB Apple M5 MacBook Air / Chrome desktop', p95ProvingMs:5000, sampledPeakBrowserTreeRSSBytes:2*1024*1024*1024},
    withinProvisionalBudget:percentile(measurements.timings.map(t=>t.provingMs))<=5000 && peak<=2*1024*1024*1024}
  const output=process.env.ZKML_BENCHMARK_OUTPUT || fileURLToPath(new URL('../../docs/M2-browser-benchmark.json', import.meta.url))
  await writeFile(output, JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
} finally { clearInterval(timer); if(browser) await browser.close(); await new Promise(ok=>server.close(ok)) }
