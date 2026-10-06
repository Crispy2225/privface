/** Owns the stream and releases even requests that resolve after cancellation. */
export class CameraSession {
  private generation = 0
  private stream: MediaStream | null = null

  stop() {
    this.generation += 1
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = null
  }

  async start(getMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
    this.stop()
    const generation = this.generation
    try {
      const stream = await getMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop())
        return null
      }
      this.stream = stream
      return stream
    } catch (error) {
      if (generation !== this.generation) return null
      throw error
    }
  }
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError': case 'PermissionDeniedError':
      return 'Camera access was blocked. Allow camera access in your browser’s site settings and your device’s privacy settings, then try again.'
    case 'NotFoundError': case 'DevicesNotFoundError':
      return 'No camera was found. Connect a camera and try again.'
    case 'NotReadableError': case 'TrackStartError':
      return 'Your camera could not start. Close other apps using it, check your device’s camera permissions, and try again.'
    case 'OverconstrainedError':
      return 'This camera cannot provide a compatible video stream. Try another camera or browser.'
    case 'SecurityError':
      return 'This browser has disabled camera access. Open PrivFace on localhost or HTTPS in a browser with camera support.'
    default:
      return 'The camera could not start. Check your camera connection and browser permissions, then try again.'
  }
}
