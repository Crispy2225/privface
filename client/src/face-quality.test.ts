import { test } from 'node:test'
import assert from 'node:assert/strict'
import { faceBounds, faceCrop, imageQuality } from './face-quality.ts'
import { observationFromResult } from './face-observation.ts'

function frame(pixel: (x: number, y: number) => number) {
  return Uint8ClampedArray.from(Array.from({ length: 96 * 96 }, (_, i) => {
    const value = pixel(i % 96, Math.floor(i / 96))
    return [value, value, value, 255]
  }).flat())
}

test('dark, overexposed, featureless and blurred face samples have actionable feedback', () => {
  assert.match(imageQuality(frame(() => 15), 96, 96).issue!, /dark/)
  assert.match(imageQuality(frame(() => 255), 96, 96).issue!, /overexposed/)
  assert.match(imageQuality(frame(() => 120), 96, 96).issue!, /detail/)
  assert.match(imageQuality(frame(x => 50 + 1.5 * x), 96, 96).issue!, /focus/)
  assert.equal(imageQuality(frame((x, y) => ((x >> 3) + (y >> 3)) % 2 ? 170 : 70), 96, 96).issue, undefined)
})

test('face crop uses the same physical size in landscape and portrait without stretching', () => {
  for (const [width, height] of [[1280, 720], [720, 1280], [640, 480]]) {
    const crop = faceCrop({ x: 0.5 - 90 / width, y: 0.5 - 120 / height, width: 180 / width, height: 240 / height }, width, height)!
    assert.ok(Math.abs(crop.width - 276) < 1e-9)
    assert.equal(crop.width, crop.height)
    assert.ok(Math.abs(crop.x + crop.width / 2 - width / 2) < 1e-9)
    assert.ok(Math.abs(crop.y + crop.height / 2 - height / 2) < 1e-9)
  }
})

test('invalid and clipped crops cannot be captured', () => {
  assert.equal(faceBounds([]), null)
  assert.equal(faceCrop({ x: 0, y: 0, width: 0.5, height: 0.7 }, 640, 480), null)
  assert.equal(faceCrop({ x: NaN, y: 0.3, width: 0.3, height: 0.3 }, 640, 480), null)
  assert.throws(() => imageQuality([], 96, 96), /Invalid/)
})

function result(width: number, height: number) {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
  points[10].y -= 130 / height; points[152].y += 130 / height
  points[234].x -= 100 / width; points[454].x += 100 / width
  points[33] = { x: 0.5 - 55 / width, y: 0.5 - 30 / height }
  points[263] = { x: 0.5 + 55 / width, y: 0.5 - 30 / height }
  return { faceLandmarks: [points], faceBlendshapes: [] }
}

test('a usable face is not rejected just because the camera is portrait', () => {
  for (const [width, height] of [[1280, 720], [720, 1280]]) {
    assert.equal(observationFromResult(result(width, height), width, height).issue, undefined)
    const tilted = result(width, height)
    tilted.faceLandmarks[0][263].y += 40 / height
    assert.match(observationFromResult(tilted, width, height).issue!, /upright/)
  }
})

test('invalid eye and nose coordinates cannot bypass the upright-face check', () => {
  for (const index of [1, 33, 263]) {
    const detected = result(640, 480)
    detected.faceLandmarks[0][index].y = NaN
    assert.match(observationFromResult(detected, 640, 480).issue!, /unclear/)
  }
})
