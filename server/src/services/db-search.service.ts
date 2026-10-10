import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import readline from 'node:readline'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Express } from 'express'
import express from 'express'

export interface DbSearchSettings { vectorLibraryPath: string; audioLibraryPath: string }
const empty: DbSearchSettings = { vectorLibraryPath: '', audioLibraryPath: '' }

export class DbSearchSettingsRepository {
  constructor(private file = fileURLToPath(new URL('../../data/db-search-settings.json', import.meta.url))) {}
  read(): DbSearchSettings {
    return fs.existsSync(this.file) ? this.validate(JSON.parse(fs.readFileSync(this.file, 'utf8'))) : { ...empty }
  }
  validate(value: unknown): DbSearchSettings {
    const item = value as DbSearchSettings
    if (!item || typeof item.vectorLibraryPath !== 'string' || typeof item.audioLibraryPath !== 'string') {
      throw new Error('向量库路径和音频库路径必须是字符串')
    }
    return { vectorLibraryPath: item.vectorLibraryPath.trim(), audioLibraryPath: item.audioLibraryPath.trim() }
  }
  write(value: unknown) {
    const settings = this.validate(value)
    for (const root of Object.values(settings)) {
      if (!path.isAbsolute(root) || !fs.statSync(root).isDirectory()) throw new Error('请填写存在的绝对目录路径')
    }
    if (!fs.existsSync(path.join(settings.vectorLibraryPath, 'MODEL_REGISTRY.json'))) throw new Error('向量库缺少 MODEL_REGISTRY.json')
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(settings, null, 2))
    fs.renameSync(`${this.file}.tmp`, this.file)
    return settings
  }
}

class DbWorker {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private stderr = ''
  private start() {
    if (this.child) return this.child
    const candidates = [
      fileURLToPath(new URL('../../.venv/Scripts/python.exe', import.meta.url)),
      fileURLToPath(new URL('../../.venv/bin/python', import.meta.url)),
      fileURLToPath(new URL('../../../../AISVCs/.venv/Scripts/python.exe', import.meta.url)),
    ]
    const python = process.env.AISVC_DB_PYTHON?.trim() || process.env.AISVC_WHISPER_PYTHON?.trim()
      || candidates.find(file => fs.existsSync(file)) || 'python'
    const script = fileURLToPath(new URL('../../scripts/db_search.py', import.meta.url))
    const child = spawn(python, ['-u', script], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', OMP_NUM_THREADS: '4', OPENBLAS_NUM_THREADS: '4' },
    })
    this.child = child
    this.stderr = ''
    child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-3000) })
    readline.createInterface({ input: child.stdout }).on('line', line => {
      try {
        const message = JSON.parse(line)
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(message.error))
        else pending.resolve(message.result)
      } catch { /* Ignore non-protocol library diagnostics. */ }
    })
    const failed = (error: Error) => {
      if (this.child !== child) return
      this.child = null
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error) }
      this.pending.clear()
    }
    child.once('error', failed)
    child.once('close', code => failed(new Error(this.stderr || `DB worker exited (${code})`)))
    child.stdin.on('error', failed)
    return child
  }
  run(settings: DbSearchSettings, action: string, extra: Record<string, unknown> = {}): Promise<any> {
    if (!settings.vectorLibraryPath || !settings.audioLibraryPath) return Promise.reject(new Error('请先在设置中配置 DB 向量库和音频库路径'))
    if (this.pending.size >= 8) return Promise.reject(new Error('DB 正忙，请稍后重试'))
    return new Promise((resolve, reject) => {
      const child = this.start()
      const id = crypto.randomUUID()
      const timer = setTimeout(() => {
        // A hung inference blocks every queued operation; restart rather than enqueue forever.
        child.kill()
      }, 240000)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, action, ...settings, ...extra })}\n`)
    })
  }
  stop() { this.child?.kill() }
}

export function installDbSearchRoutes(app: Express) {
  const settings = new DbSearchSettingsRepository()
  const worker = new DbWorker()
  process.once('exit', () => worker.stop())
  const sendError = (res: express.Response, error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : 'DB 操作失败' })
  app.get('/api/db/settings', (_req, res) => {
    try { res.json(settings.read()) } catch (error) { sendError(res, error) }
  })
  app.put('/api/db/settings', (req, res) => {
    try { res.json(settings.write(req.body)) } catch (error) { sendError(res, error) }
  })
  app.post('/api/db/check', async (_req, res) => {
    try { res.json(await worker.run(settings.read(), 'check')) } catch (error) { sendError(res, error) }
  })
  app.post('/api/db/search', express.raw({ type: 'audio/wav', limit: '30mb' }), async (req, res) => {
    let directory: string | undefined
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length < 44) throw new Error('请传入 WAV 音频')
      const root = fileURLToPath(new URL('../../data/db-search-temp/', import.meta.url))
      fs.mkdirSync(root, { recursive: true })
      directory = fs.mkdtempSync(path.join(root, 'query-'))
      const inputWav = path.join(directory, 'query.wav')
      fs.writeFileSync(inputWav, req.body)
      res.json(await worker.run(settings.read(), 'search', { inputWav }))
    } catch (error) { sendError(res, error) }
    finally { if (directory) fs.rmSync(directory, { recursive: true, force: true }) }
  })
  app.get('/api/db/audio/:id', async (req, res) => {
    try {
      const result = await worker.run(settings.read(), 'audio', { segmentId: req.params.id })
      res.setHeader('Content-Type', 'audio/wav')
      res.setHeader('Cache-Control', 'no-store')
      res.send(Buffer.from(result.wavBase64, 'base64'))
    } catch (error) { sendError(res, error) }
  })
}
