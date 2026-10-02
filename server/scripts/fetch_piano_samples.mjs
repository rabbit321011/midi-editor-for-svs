import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const revision = 'efd8296360f9526e379bfbe5c1698ff54d6a1d34'
const base = `https://raw.githubusercontent.com/Tonejs/audio/${revision}/salamander/`
const destination = new URL('../../client/public/instruments/salamander/', import.meta.url)
const files = ['README', 'A0.mp3', ...Array.from({ length: 7 }, (_, i) =>
  ['C', 'Ds', 'Fs', 'A'].map(note => `${note}${i + 1}.mp3`)).flat(), 'C8.mp3']
await mkdir(destination, { recursive: true })
const manifest = { repository: 'https://github.com/Tonejs/audio', revision, files: {} }
for (const file of files) {
  const response = await fetch(base + file)
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  await writeFile(new URL(file, destination), data)
  manifest.files[file] = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }
}
await writeFile(new URL('manifest.json', destination), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Downloaded ${files.length - 1} piano samples and upstream README`)
