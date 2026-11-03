export type Point = { x: number; y: number }
export type Bounds = { x: number; y: number; width: number; height: number }

export function faceBounds(points: Point[]): Bounds | null {
  const oval = [10, 152, 234, 454, 127, 356, 172, 397].map(index => points[index])
  if (oval.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null
  const x = Math.min(...oval.map(p => p.x)), y = Math.min(...oval.map(p => p.y))
  const width = Math.max(...oval.map(p => p.x)) - x
  const height = Math.max(...oval.map(p => p.y)) - y
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

// Use pixels, not normalized coordinates: portrait and landscape frames must
// produce the same crop for the same face. Never stretch or clip the face.
export function faceCrop(bounds: Bounds, width: number, height: number): Bounds | null {
  const size = Math.max(bounds.width * width, bounds.height * height) * 1.15
  const x = (bounds.x + bounds.width / 2) * width - size / 2
  const y = (bounds.y + bounds.height / 2) * height - size / 2
  if (![x, y, size, width, height].every(Number.isFinite) || size <= 0 || x < 0 || y < 0 || x + size > width || y + size > height) return null
  return { x, y, width: size, height: size }
}

// Broad capture heuristics, not a calibrated biometric acceptance policy.
// Call on a consistently sized face ROI so resolution does not change the score.
export function imageQuality(data: ArrayLike<number>, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || data.length !== width * height * 4) throw new Error('Invalid quality frame')
  const gray = new Float64Array(width * height)
  let sum = 0, squares = 0, clipped = 0
  for (let i = 0; i < gray.length; i++) {
    const value = (77 * data[4 * i] + 150 * data[4 * i + 1] + 29 * data[4 * i + 2]) / 256
    gray[i] = value; sum += value; squares += value * value
    if (value > 250) clipped++
  }
  const brightness = sum / gray.length
  const contrast = Math.sqrt(Math.max(0, squares / gray.length - brightness ** 2))
  let edgeSum = 0, edgeSquares = 0, count = 0
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x
    const edge = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
    edgeSum += edge; edgeSquares += edge * edge; count++
  }
  const sharpness = Math.max(0, edgeSquares / count - (edgeSum / count) ** 2)
  const issue = brightness < 35 ? 'Your face is too dark. Face a light or window.'
    : clipped / gray.length > 0.55 ? 'Your face is overexposed. Move away from direct light.'
    : contrast < 8 ? 'Face detail is unclear. Use even lighting and clean the camera lens.'
    : sharpness < 12 ? 'Hold still and let the camera focus on your face.' : undefined
  return { brightness, contrast, sharpness, issue }
}

export function checkFaceQuality(source: HTMLCanvasElement, bounds: Bounds, sample: HTMLCanvasElement): string | undefined {
  if (bounds.width * source.width < 100 || bounds.height * source.height < 100) return 'Move closer so your face has enough detail.'
  sample.width = sample.height = 96
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) return 'Camera image could not be checked. Restart the camera.'
  context.drawImage(source, bounds.x * source.width, bounds.y * source.height, bounds.width * source.width, bounds.height * source.height, 0, 0, 96, 96)
  return imageQuality(context.getImageData(0, 0, 96, 96).data, 96, 96).issue
}
