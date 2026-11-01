import { useEffect, useRef, useState } from 'react'
import CameraCapture from './CameraCapture'
import { generateStudyEmbedding } from './face-embedding'
import { EMBEDDING_MODEL } from './template-crypto'
import { evaluateStudy } from './study-evaluation'
import type { StudySample } from './study-evaluation'
import type { Dataset } from './calibration'
function download(name:string,data:unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}))
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export default function StudyCollection() {
  const [subject,setSubject]=useState(''), [session,setSession]=useState(''), [split,setSplit]=useState<'calibration'|'test'>('calibration')
  const [consent,setConsent]=useState(false), [busy,setBusy]=useState(false), [message,setMessage]=useState('')
  const [samples,setSamples]=useState<StudySample[]>([])
  const active=useRef<AbortController|null>(null)
  const retained=useRef(samples);retained.current=samples
  useEffect(()=>()=>{active.current?.abort();retained.current.forEach(s=>{s.embedding.fill(0);s.experimentalEmbedding?.fill(0)})},[])
  useEffect(()=>{ const warn=(e:BeforeUnloadEvent)=>{if(retained.current.length){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[])
  async function capture(photo:string) {
    if(active.current) return
    if(samples.length>=1000){setMessage('Export and clear this pilot before collecting more than 1,000 samples.');return}
    if(!consent || !subject.trim() || !session.trim()) {setMessage('Enter a participant code, session code, and consent first.');return}
    if(samples.some(s=>s.subject===subject.trim() && s.split!==split)) {setMessage('Keep each participant in exactly one split.');return}
    const controller=new AbortController();active.current=controller;setBusy(true)
    try {
      const extracted=await generateStudyEmbedding(photo,controller.signal);controller.signal.throwIfAborted()
      setSamples(old=>[...old,{id:crypto.randomUUID(),subject:subject.trim(),session:session.trim(),split,...extracted}])
      setMessage('Sample added locally. Retake for another independent capture; export before leaving this page.')
    } catch(error) {if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:'Capture failed')}
    finally {if(active.current===controller){active.current=null;setBusy(false)}}
  }
  function report() {
    try {const result=evaluateStudy({model:EMBEDDING_MODEL,samples});download('privface-calibration-report.json',result);setMessage(`Report exported. Held-out FAR: ${result.baseline.heldOut.FAR}; FRR: ${result.baseline.heldOut.FRR}. The active policy has NOT been changed.`)}
    catch(error){setMessage(error instanceof Error?error.message:'Evaluation failed')}
  }
  return <main className="auth-panel study-panel">
    <a href="/">← Back to PrivFace</a><h1>Collect calibration samples</h1>
    <p>Use participant codes, not names. Obtain each participant’s consent before capture. Images stay in page memory; exports contain sensitive face descriptors. Keep exports private and delete them when your study ends.</p>
    <p>Use separate participants for calibration and held-out testing. Capture each participant across at least two sessions with different lighting or on different days. A useful minimum for exercising the report is 4 participants in each split, with 3 captures in each of 2 sessions. This is a pilot, not a claim of population accuracy.</p>
    <label className="field">Participant code<input disabled={busy} value={subject} maxLength={64} onChange={e=>{setSubject(e.target.value);setConsent(false)}} /></label>
    <label className="field">Capture session code<input disabled={busy} value={session} maxLength={64} onChange={e=>setSession(e.target.value)} /></label>
    <label className="field">Split<select disabled={busy} value={split} onChange={e=>setSplit(e.target.value as 'calibration'|'test')}><option value="calibration">Calibration</option><option value="test">Held-out test</option></select></label>
    <label className="consent"><input disabled={busy} type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} />This participant consented to local capture and evaluation.</label>
    {consent && subject.trim() && session.trim() && <CameraCapture key={subject+'|'+session+'|'+split} studyCapture={capture} studyBusy={busy} />}
    <p>Each capture evaluates the enrolled model and an experimental UINT8 weight-storage variant on the same aligned crop. Both currently run floating-point inference. Exports include paired descriptors and inference times.</p>
    <p>{samples.length} samples held in this page. Nothing uploads automatically.</p>
    <button className="secondary-button" disabled={!samples.length || busy} onClick={()=>download('privface-consented-samples.json',{model:EMBEDDING_MODEL,samples})}>Export sensitive dataset</button>
    <label className="field">Import a previously exported dataset<input type="file" accept="application/json,.json" disabled={busy} onChange={async e=>{
      const file=e.target.files?.[0];if(!file)return
      try {if(file.size>10_000_000)throw new Error('Dataset too large');const data=JSON.parse(await file.text()) as Dataset
        if(data.model!==EMBEDDING_MODEL || !Array.isArray(data.samples))throw new Error('Invalid dataset')
        const merged=[...samples,...data.samples];if(merged.length>1000)throw new Error('Limit this pilot to 1,000 samples')
        const ids=new Set<string>(),subjects=new Map<string,string>()
        for(const s of merged){if(!s.id||ids.has(s.id)||typeof s.subject!=='string'||!s.subject||typeof s.session!=='string'||!s.session||!['test','calibration'].includes(s.split)||!Array.isArray(s.embedding)||s.embedding.length!==128||!s.embedding.every(Number.isFinite)||s.embedding.every(v=>v===0))throw new Error('Invalid or duplicate sample');ids.add(s.id);if(subjects.has(s.subject)&&subjects.get(s.subject)!==s.split)throw new Error('Participant appears in both splits');subjects.set(s.subject,s.split)}
        setSamples(merged);setMessage('Imported locally. Confirm that these samples have participant consent.')
      }catch(error){setMessage(error instanceof Error?error.message:'Import failed')}finally{e.target.value=''}
    }} /></label>
    <button className="secondary-button" disabled={busy || !samples.length} onClick={report}>Evaluate and export report</button>
    <button className="text-button" disabled={busy || !samples.length} onClick={()=>{samples.forEach(s=>{s.embedding.fill(0);s.experimentalEmbedding?.fill(0)});setSamples([]);setMessage('In-page descriptors cleared. Previously downloaded files remain on your computer.')}}>Clear in-page samples</button>
    <p role="status">{message}</p>
  </main>
}
