import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LivenessSession } from './liveness.ts'
import type { Action, Observation } from './liveness.ts'
import { observationFromResult } from './face-observation.ts'

const neutral: Observation = { faceCount: 1, yaw: 0, leftBlink: 0.05, rightBlink: 0.05, centerX: 0.5, centerY: 0.5 }
function fixture(order: Action[] = ['blink', 'left', 'right']) {
  const session = new LivenessSession(order)
  let now = 0
  let result = session.reset()
  function feed(count: number, changes: Partial<Observation> = {}) {
    for (let i = 0; i < count; i++) { now += 100; result = session.observe({ ...neutral, ...changes }, now) }
    return result
  }
  function pass() {
    feed(11)
    for (const action of order) {
      if (action === 'blink') { feed(3); feed(3, { leftBlink: 0.8, rightBlink: 0.8 }); feed(3) }
      else { feed(5, { yaw: action === 'left' ? 0.25 : -0.25 }); feed(5) }
    }
    return feed(8)
  }
  return { session, feed, pass, time: () => now }
}

test('a stationary photo-like observation never passes', () => {
  const f = fixture()
  for (let i = 0; i < 700; i++) assert.equal(f.feed(1).canCapture, false)
})
test('a full open-close-open eye action and both head turns enable a short capture window', () => {
  const f = fixture()
  assert.equal(f.pass().canCapture, true)
  assert.equal(f.session.isFresh(f.time()), true)
})
test('each randomized action ordering is supported', () => {
  for (const order of [['left', 'blink', 'right'], ['right', 'left', 'blink'], ['blink', 'right', 'left']] as Action[][]) assert.equal(fixture(order).pass().canCapture, true)
})
test('closed eyes from the start cannot establish a baseline', () => {
  const f = fixture()
  assert.equal(f.feed(100, { leftBlink: 0.8, rightBlink: 0.8 }).completed, 0)
})
test('a wink or brief single-frame blink cannot complete the eye challenge', () => {
  const f = fixture()
  f.feed(15)
  assert.equal(f.feed(6, { leftBlink: 0.9 }).completed, 0)
  f.feed(3)
  f.feed(1, { leftBlink: 0.9, rightBlink: 0.9 })
  assert.equal(f.feed(4).completed, 0)
})
test('eyes must reopen promptly after closing', () => {
  const f = fixture()
  f.feed(15)
  assert.equal(f.feed(25, { leftBlink: 0.9, rightBlink: 0.9 }).canCapture, false)
  assert.equal(f.feed(1).completed, 0)
})
test('head turning in the wrong direction does not progress', () => {
  const f = fixture(['left', 'right', 'blink'])
  f.feed(11)
  assert.equal(f.feed(8, { yaw: -0.25 }).completed, 0)
})
test('turning without returning to center does not complete the step', () => {
  const f = fixture(['left', 'right', 'blink'])
  f.feed(11)
  assert.equal(f.feed(12, { yaw: 0.25 }).completed, 0)
})
test('no face and multiple faces immediately revoke a passed check', () => {
  for (const faceCount of [0, 2]) {
    const f = fixture(); f.pass()
    assert.equal(f.feed(1, { faceCount }).canCapture, false)
    assert.equal(f.feed(1).completed, 0)
  }
})
test('poor framing, missing scores and sudden movement revoke passed checks', () => {
  for (const changes of [{ issue: 'Move closer' }, { leftBlink: NaN }, { centerX: 0.7 }, { yaw: 0.2 }]) {
    const f = fixture(); f.pass()
    assert.equal(f.feed(1, changes).canCapture, false)
  }
})
test('frozen video and stale capture requests cannot retain approval', () => {
  const f = fixture(); f.pass()
  assert.equal(f.session.isFresh(f.time() + 501), false)
  assert.equal(f.session.observe(neutral, f.time() + 700).canCapture, false)
})
test('repeated/non-monotonic timestamps reset the challenge', () => {
  const f = fixture(); f.pass()
  assert.equal(f.session.observe(neutral, f.time()).canCapture, false)
})
test('capture approval expires even with continuous neutral frames', () => {
  const f = fixture(); f.pass()
  assert.equal(f.feed(65).canCapture, false)
})
test('an explicit retry requires all challenges again', () => {
  const f = fixture(); f.pass()
  assert.equal(f.session.reset().canCapture, false)
  assert.equal(f.session.isFresh(f.time()), false)
})

function landmarkFixture() {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
  points[10] = { x: 0.5, y: 0.25 }; points[152] = { x: 0.5, y: 0.75 }
  points[234] = { x: 0.3, y: 0.5 }; points[454] = { x: 0.7, y: 0.5 }
  points[33] = { x: 0.4, y: 0.45 }; points[263] = { x: 0.6, y: 0.45 }
  return { faceLandmarks: [points], faceBlendshapes: [{ categories: [{ categoryName: 'eyeBlinkLeft', score: 0.1 }, { categoryName: 'eyeBlinkRight', score: 0.1 }] }] }
}
test('landmarks map to centered face and open-eye metrics', () => {
  const result = observationFromResult(landmarkFixture())
  assert.equal(result.issue, undefined); assert.equal(result.yaw, 0); assert.equal(result.centerX, 0.5)
})
test('small, off-center and clipped faces receive positioning feedback', () => {
  const small = landmarkFixture()
  small.faceLandmarks[0] = small.faceLandmarks[0].map(p => ({ x: 0.5 + (p.x - 0.5) / 4, y: 0.5 + (p.y - 0.5) / 4 }))
  assert.match(observationFromResult(small).issue!, /closer/)
  const side = landmarkFixture()
  side.faceLandmarks[0] = side.faceLandmarks[0].map(p => ({ ...p, x: p.x + 0.3 }))
  assert.match(observationFromResult(side).issue!, /Center/)
})
test('absent blendshapes and invalid landmark geometry fail closed', () => {
  const f = landmarkFixture(); f.faceBlendshapes = []
  assert.equal(new LivenessSession().observe(observationFromResult(f), 1).canCapture, false)
  f.faceLandmarks[0][10].x = NaN
  assert.match(observationFromResult(f).issue!, /unclear/)
})
