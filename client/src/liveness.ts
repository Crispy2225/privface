/** Heuristic challenge/response for the local prototype, NOT a trusted authentication result. */
export type Action = 'blink' | 'left' | 'right'
export type Observation = {
  faceCount: number
  issue?: string
  yaw: number
  leftBlink: number
  rightBlink: number
  centerX: number
  centerY: number
}
export type Validation = {
  state: 'loading' | 'position' | 'challenge' | 'passed' | 'error'
  message: string
  completed: number
  canCapture: boolean
}
export const INITIAL_VALIDATION: Validation = { state: 'loading', message: 'Loading face detection on your device…', completed: 0, canCapture: false }

function randomActions(): Action[] {
  const actions: Action[] = ['blink', 'left', 'right']
  const values = crypto.getRandomValues(new Uint32Array(2))
  for (let i = 2; i > 0; i--) {
    const j = values[2 - i] % (i + 1)
    ;[actions[i], actions[j]] = [actions[j], actions[i]]
  }
  return actions
}

export class LivenessSession {
  private actions: Action[]
  private fixedActions?: Action[]
  private phase: 'calibrate' | 'action' | 'settle' | 'passed' = 'calibrate'
  private subphase = 'open'
  private index = 0
  private heldSince: number | null = null
  private phaseStarted = 0
  private closedSince = 0
  private baseline = 0
  private previousTime: number | null = null
  private previous: Observation | null = null
  private passedAt = 0
  private latest: Validation = { state: 'position', message: 'Look straight ahead with both eyes open.', completed: 0, canCapture: false }

  constructor(actions?: Action[]) {
    this.fixedActions = actions
    this.actions = actions ? [...actions] : randomActions()
  }

  reset(message = 'Look straight ahead with both eyes open.'): Validation {
    this.actions = this.fixedActions ? [...this.fixedActions] : randomActions()
    this.phase = 'calibrate'
    this.subphase = 'open'
    this.index = 0
    this.heldSince = null
    this.previousTime = null
    this.previous = null
    this.phaseStarted = 0
    this.passedAt = 0
    return this.view('position', message)
  }

  private view(state: Validation['state'], message: string): Validation {
    this.latest = { state, message, completed: this.index, canCapture: state === 'passed' }
    return this.latest
  }

  private hold(condition: boolean, now: number, duration: number): boolean {
    if (!condition) { this.heldSince = null; return false }
    this.heldSince ??= now
    return now - this.heldSince >= duration
  }

  private next(now: number) {
    this.index++
    this.heldSince = null
    this.subphase = 'open'
    this.phaseStarted = now
    if (this.index === this.actions.length) this.phase = 'settle'
  }

  isFresh(now: number): boolean {
    return this.latest.canCapture && this.previousTime !== null && now - this.previousTime <= 500 && now - this.passedAt < 6000
  }

  observe(face: Observation, now: number): Validation {
    if (!Number.isFinite(now)) return this.reset('Camera timing unavailable. Restart the camera.')
    if (this.previousTime !== null && (now <= this.previousTime || now - this.previousTime > 650)) return this.reset('Video interrupted. Look straight ahead to restart.')
    if (face.faceCount !== 1) return this.reset(face.faceCount > 1 ? 'Multiple faces detected. Only one person should be in view.' : 'No face detected. Look toward the camera.')
    if (face.issue) return this.reset(face.issue)
    if (![face.yaw, face.leftBlink, face.rightBlink, face.centerX, face.centerY].every(Number.isFinite)) return this.reset('Face landmarks are unclear. Improve the lighting.')
    if (this.previous && Math.hypot(face.centerX - this.previous.centerX, face.centerY - this.previous.centerY) > 0.14) return this.reset('Face position changed suddenly. Start again.')
    this.previousTime = now
    this.previous = face
    const open = face.leftBlink < 0.25 && face.rightBlink < 0.25
    const closed = face.leftBlink > 0.55 && face.rightBlink > 0.55
    const neutral = Math.abs(face.yaw - this.baseline) < 0.075

    if (this.phase === 'calibrate') {
      const aligned = Math.abs(face.yaw) < 0.13 && open
      if (this.hold(aligned, now, 800)) {
        this.baseline = face.yaw
        this.phase = 'action'
        this.phaseStarted = now
        this.heldSince = null
      } else return this.view('position', aligned ? 'Good position. Hold still for a moment.' : 'Look straight ahead with both eyes open.')
    }
    if (this.phase === 'passed') {
      if (now - this.passedAt >= 6000) return this.reset('Capture window expired. Repeat the quick check.')
      if (!neutral || !open) return this.reset('Keep facing forward. Repeat the quick check.')
      return this.view('passed', 'Movement check complete. Ready to capture.')
    }
    if (now - this.phaseStarted > 12000) return this.reset('That step timed out. Look straight ahead to try again.')
    if (this.phase === 'settle') {
      if (this.hold(neutral && open, now, 600)) {
        this.phase = 'passed'
        this.passedAt = now
        return this.view('passed', 'Movement check complete. Ready to capture.')
      }
      return this.view('challenge', 'Look straight ahead and hold still for your photo.')
    }

    const action = this.actions[this.index]
    if (action === 'blink') {
      if (!neutral) { this.subphase = 'open'; this.heldSince = null; return this.view('challenge', 'Face forward for the eye check.') }
      if (this.subphase === 'open') {
        if (this.hold(open, now, 200)) { this.subphase = 'close'; this.heldSince = null }
        return this.view('challenge', 'Keep your eyes open, then close both eyes briefly.')
      }
      if (this.subphase === 'close') {
        if (this.hold(closed, now, 120)) { this.subphase = 'reopen'; this.closedSince = now; this.heldSince = null }
        return this.view('challenge', 'Close both eyes briefly, then open them.')
      }
      if (now - this.closedSince > 1800) return this.reset('Eye check timed out. Open your eyes and start again.')
      if (this.hold(open, now, 150)) { this.next(now); return this.view('challenge', 'Eye check complete. Follow the next instruction.') }
      return this.view('challenge', 'Open both eyes again.')
    }
    // Raw frames are unmirrored, so positive nose displacement maps to screen-left.
    const turned = action === 'left' ? face.yaw - this.baseline > 0.16 : face.yaw - this.baseline < -0.16
    if (this.subphase !== 'return') {
      if (this.hold(turned && open, now, 300)) { this.subphase = 'return'; this.heldSince = null }
      return this.view('challenge', action === 'left' ? '← Turn your head gently toward the left arrow.' : 'Turn your head gently toward the right arrow. →')
    }
    if (this.hold(neutral && open, now, 300)) { this.next(now); return this.view('challenge', 'Head turn complete. Follow the next instruction.') }
    return this.view('challenge', 'Return to the center and look straight ahead.')
  }
}
