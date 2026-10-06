import type { Observation } from './liveness.ts'

type Point = { x: number; y: number }
type Category = { categoryName: string; score: number }
type LandmarkResult = { faceLandmarks: Point[][]; faceBlendshapes: { categories: Category[] }[] }

export function observationFromResult(result: LandmarkResult): Observation {
  const base: Observation = { faceCount: result.faceLandmarks.length, yaw: NaN, leftBlink: NaN, rightBlink: NaN, centerX: NaN, centerY: NaN }
  if (base.faceCount !== 1) return base
  const points = result.faceLandmarks[0]
  // Face oval, nose tip and outer eye corners; no identity embedding is derived.
  const oval = [10, 152, 234, 454, 127, 356, 172, 397].map(index => points[index])
  if (oval.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return { ...base, issue: 'Face landmarks are unclear. Improve the lighting.' }
  const xs = oval.map(p => p.x), ys = oval.map(p => p.y)
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys)
  const width = right - left, height = bottom - top
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2
  let issue: string | undefined
  if (width < 0.20 || height < 0.28) issue = 'Move a little closer to the camera.'
  else if (width > 0.72 || height > 0.92) issue = 'Move a little farther from the camera.'
  else if (left < 0.03 || right > 0.97 || top < 0.02 || bottom > 0.98 || Math.abs(centerX - 0.5) > 0.18 || Math.abs(centerY - 0.5) > 0.19) issue = 'Center your whole face in the camera view.'
  const eyeA = points[33], eyeB = points[263], nose = points[1]
  const eyeWidth = eyeA && eyeB ? Math.abs(eyeB.x - eyeA.x) : 0
  const yaw = eyeWidth > 0.04 && nose ? (nose.x - (eyeA.x + eyeB.x) / 2) / eyeWidth : NaN
  const categories = result.faceBlendshapes[0]?.categories ?? []
  const leftBlink = categories.find(c => c.categoryName === 'eyeBlinkLeft')?.score ?? NaN
  const rightBlink = categories.find(c => c.categoryName === 'eyeBlinkRight')?.score ?? NaN
  return { ...base, issue, centerX, centerY, yaw, leftBlink, rightBlink }
}
