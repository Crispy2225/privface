import { evaluate } from './calibration.ts'
import type { Dataset } from './calibration.ts'
export const EXPERIMENTAL_MODEL='face-api.js@0.22.2/faceRecognitionNet/all-uint8-storage-v1'
export type StudySample=Dataset['samples'][number]&{experimentalEmbedding?:number[];experimentalModel?:string;baselineMs?:number;experimentalMs?:number}
export type StudyDataset={model:string;samples:StudySample[]}
export function evaluateStudy(dataset:StudyDataset){
  const baseline=evaluate(dataset)
  const paired=dataset.samples.filter(s=>s.experimentalModel===EXPERIMENTAL_MODEL && s.experimentalEmbedding)
  if(paired.length!==dataset.samples.length)return {baseline,experimental:null,note:'All samples need paired descriptors from the same captures to compare models.'}
  const experimental=evaluate({model:dataset.model,samples:paired.map(s=>({...s,embedding:s.experimentalEmbedding!}))})
  let maxDescriptorDrift=0
  for(const s of paired)maxDescriptorDrift=Math.max(maxDescriptorDrift,Math.sqrt(s.embedding.reduce((sum,v,i)=>sum+(v-s.experimentalEmbedding![i])**2,0)))
  const timed=paired.filter(s=>Number.isFinite(s.baselineMs)&&Number.isFinite(s.experimentalMs))
  return {baseline,experimental:{...experimental,policy:{...experimental.policy,model:EXPERIMENTAL_MODEL}},maxDescriptorDrift,
    timing:timed.length?{samples:timed.length,baselineMeanMs:timed.reduce((sum,s)=>sum+s.baselineMs!,0)/timed.length,experimentalMeanMs:timed.reduce((sum,s)=>sum+s.experimentalMs!,0)/timed.length}:null,
    note:'Paired study, subject-disjoint splits. Timings cover descriptor inference on the same aligned crop, exclude model loading/detection, and alternate model order. UINT8 weight storage still executes floating-point inference. Each threshold is selected independently using calibration subjects only; neither is installed automatically.'}
}
