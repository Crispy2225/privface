import { generateEmbedding } from '../src/face-embedding'
import { EMBEDDING_MODEL } from '../src/template-crypto'
const status = document.querySelector('#status')!
const run = document.querySelector<HTMLButtonElement>('#run')!
const link = document.querySelector<HTMLAnchorElement>('#download')!
let url: string | undefined
run.onclick = async () => {
  if (!document.querySelector<HTMLInputElement>('#consent')!.checked) { status.textContent = 'Storage/export consent is required.'; return }
  run.disabled = true; link.hidden = true
  if (url) URL.revokeObjectURL(url)
  const samples = []
  try {
    for (const file of document.querySelector<HTMLInputElement>('#images')!.files ?? []) {
      const match = /^(calibration|test)__([^_]+)__([^_]+)__([^\.]+)\.[^.]+$/.exec(file.name)
      if (!match) throw new Error('Invalid study filename: ' + file.name)
      const imageURL = URL.createObjectURL(file), start = performance.now()
      try {
        const embedding = await generateEmbedding(imageURL, new AbortController().signal)
        samples.push({ id: file.name, split: match[1], subject: match[2], session: match[3], embedding, extractionMs: performance.now() - start })
        status.textContent = `Processed ${samples.length} images locally.`
      } finally { URL.revokeObjectURL(imageURL) }
    }
    if (!samples.length) throw new Error('Select study images first.')
    url = URL.createObjectURL(new Blob([JSON.stringify({ model: EMBEDDING_MODEL, samples }, null, 2)], { type: 'application/json' }))
    link.href = url; link.download = 'private-evaluation.json'; link.hidden = false
  } catch (error) { status.textContent = String(error) }
  finally { run.disabled = false }
}
