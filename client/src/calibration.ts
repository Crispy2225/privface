import { compareFaces, QUANTIZATION, quantize, SCALE } from './face-match.ts'
import { EMBEDDING_MODEL, validateEmbedding } from './template-crypto.ts'

type Sample = { id: string; subject: string; session: string; split: 'calibration' | 'test'; embedding: number[] }
export type Dataset = { model: string; samples: Sample[] }
export function evaluate(dataset: Dataset, targetFAR = 0.01, minimumPairs = 20) {
  if (dataset.model !== EMBEDDING_MODEL || !Array.isArray(dataset.samples) || !Number.isFinite(targetFAR) || targetFAR < 0 || targetFAR > 1) throw new Error('Invalid dataset/model or target FAR.')
  const ids = new Set<string>(), subjects = new Map<string, string>()
  for (const sample of dataset.samples) {
    if (!sample.id || !sample.subject || !sample.session || !['calibration', 'test'].includes(sample.split) || ids.has(sample.id)) throw new Error('Samples need unique IDs, subjects, sessions and valid splits.')
    ids.add(sample.id)
    if (subjects.has(sample.subject) && subjects.get(sample.subject) !== sample.split) throw new Error('Subject leakage between calibration and held-out test data.')
    subjects.set(sample.subject, sample.split)
    validateEmbedding(sample.embedding); quantize(sample.embedding)
  }
  const pairs = { calibration: [] as { genuine: boolean; distance: number; raw: number }[], test: [] as { genuine: boolean; distance: number; raw: number }[] }
  for (let i = 0; i < dataset.samples.length; i++) for (let j = i + 1; j < dataset.samples.length; j++) {
    const a = dataset.samples[i], b = dataset.samples[j]
    if (a.split !== b.split || (a.subject === b.subject && a.session === b.session)) continue
    const raw = Math.sqrt(a.embedding.reduce((sum, value, k) => sum + (value - b.embedding[k]) ** 2, 0))
    pairs[a.split].push({ genuine: a.subject === b.subject, distance: compareFaces(a.embedding, b.embedding).distance, raw })
  }
  for (const split of Object.values(pairs)) {
    if (split.filter(p => p.genuine).length < minimumPairs || split.filter(p => !p.genuine).length < minimumPairs) throw new Error(`Each split requires at least ${minimumPairs} genuine and impostor pairs from separate captures.`)
  }
  const distributions = new Map(Object.values(pairs).map(split => [split, {
    genuine: split.filter(p => p.genuine).map(p => Math.round((p.distance * SCALE) ** 2)).sort((a,b) => a-b),
    impostor: split.filter(p => !p.genuine).map(p => Math.round((p.distance * SCALE) ** 2)).sort((a,b) => a-b),
    rawGenuine: split.filter(p => p.genuine).map(p => p.raw).sort((a,b) => a-b),
    rawImpostor: split.filter(p => !p.genuine).map(p => p.raw).sort((a,b) => a-b),
  }]))
  function countAccepted(sorted: number[], limit: number) {
    let low=0, high=sorted.length
    while (low<high) { const mid=Math.floor((low+high)/2); if (sorted[mid]<=limit) low=mid+1; else high=mid }
    return low
  }
  function metrics(split: typeof pairs.test, threshold: number, raw = false) {
    const d = distributions.get(split)!
    const genuine = raw ? d.rawGenuine : d.genuine, impostor = raw ? d.rawImpostor : d.impostor
    const limit = raw ? threshold : Math.floor((threshold*SCALE)**2)
    const falseAccepts=countAccepted(impostor,limit), falseRejects=genuine.length-countAccepted(genuine,limit)
    return { genuine: genuine.length, impostor: impostor.length, falseAccepts, falseRejects, FAR: falseAccepts/impostor.length, FRR: falseRejects/genuine.length }
  }
  // Select on calibration only, then report held-out test results without tuning.
  const candidates = [...new Set([1 / SCALE, ...pairs.calibration.map(p => Math.min(2, p.distance + 1e-10))])].filter(v => v > 0 && v <= 2).sort((a,b) => a-b)
  const choices = candidates.map(threshold => ({ threshold, ...metrics(pairs.calibration, threshold) })).filter(m => m.FAR <= targetFAR)
  choices.sort((a,b) => a.FRR - b.FRR || a.threshold - b.threshold)
  if (!choices.length) throw new Error('No usable threshold meets the requested calibration FAR.')
  const threshold = choices[0].threshold
  let maxComponentError = 0
  for (const sample of dataset.samples) {
    const q = quantize(sample.embedding)
    sample.embedding.forEach((v,i) => { maxComponentError = Math.max(maxComponentError, Math.abs(v - q[i] / SCALE)) })
  }
  let maxDistanceDrift = 0
  for (const pair of pairs.calibration.concat(pairs.test)) maxDistanceDrift = Math.max(maxDistanceDrift, Math.abs(pair.distance-pair.raw))
  return {
    policy: { model: EMBEDDING_MODEL, quantization: QUANTIZATION, threshold, calibrated: true, note: 'Measured on the supplied dataset only; review held-out results before deployment.' },
    targetFAR, subjects: subjects.size, samples: ids.size, calibration: metrics(pairs.calibration, threshold), heldOut: metrics(pairs.test, threshold),
    floatAtSameThreshold: metrics(pairs.test, threshold, true), maxComponentError,
    maxDistanceDrift: maxDistanceDrift,
    roc: candidates.map(value => ({ threshold: value, ...metrics(pairs.test, value) })),
    caution: 'Pairs share subjects/captures and are not independent trials. Zero observed false accepts is not a guarantee. Full neural-network INT8 inference is not evaluated here.',
  }
}
