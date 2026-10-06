import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CameraSession, cameraErrorMessage } from './camera-session.ts'

function fakeStream() {
  let stopped = 0
  return { stream: { getTracks: () => [{ stop: () => { stopped++ } }] } as unknown as MediaStream, stopped: () => stopped }
}

test('requests video only and releases the active stream on stop', async () => {
  const session = new CameraSession()
  const fake = fakeStream()
  const result = await session.start(async constraints => {
    assert.equal(constraints.audio, false)
    assert.equal((constraints.video as MediaTrackConstraints).facingMode, 'user')
    return fake.stream
  })
  assert.equal(result, fake.stream)
  session.stop()
  session.stop()
  assert.equal(fake.stopped(), 1)
})

test('permission resolving after leaving the page does not leak a stream', async () => {
  const session = new CameraSession()
  const fake = fakeStream()
  let resolve!: (stream: MediaStream) => void
  const pending = session.start(() => new Promise<MediaStream>(done => { resolve = done }))
  session.stop()
  resolve(fake.stream)
  assert.equal(await pending, null)
  assert.equal(fake.stopped(), 1)
})

test('a newer request cannot be replaced by an older delayed result', async () => {
  const session = new CameraSession()
  const first = fakeStream()
  const second = fakeStream()
  let resolve!: (stream: MediaStream) => void
  const pending = session.start(() => new Promise<MediaStream>(done => { resolve = done }))
  assert.equal(await session.start(async () => second.stream), second.stream)
  resolve(first.stream)
  assert.equal(await pending, null)
  assert.equal(first.stopped(), 1)
  assert.equal(second.stopped(), 0)
  session.stop()
  assert.equal(second.stopped(), 1)
})

test('restarting releases the previous camera before opening a new one', async () => {
  const session = new CameraSession()
  const first = fakeStream()
  const second = fakeStream()
  await session.start(async () => first.stream)
  await session.start(async () => { assert.equal(first.stopped(), 1); return second.stream })
  session.stop()
  assert.equal(second.stopped(), 1)
})

test('a rejected request after cancellation does not overwrite the current UI', async () => {
  const session = new CameraSession()
  let reject!: (error: Error) => void
  const pending = session.start(() => new Promise<MediaStream>((_, fail) => { reject = fail }))
  session.stop()
  reject(new Error('Permission denied'))
  assert.equal(await pending, null)
})

test('permission and hardware failures produce actionable messages', async () => {
  const denied = new DOMException('Denied', 'NotAllowedError')
  await assert.rejects(new CameraSession().start(async () => { throw denied }), { name: 'NotAllowedError' })
  assert.match(cameraErrorMessage(denied), /site settings/)
  assert.match(cameraErrorMessage(new DOMException('', 'NotFoundError')), /No camera/)
  assert.match(cameraErrorMessage(new DOMException('', 'NotReadableError')), /Close other apps/)
})
