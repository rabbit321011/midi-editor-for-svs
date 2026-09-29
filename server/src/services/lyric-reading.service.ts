import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

export function lyricReading(text: string): Promise<unknown> {
  const python = process.env.AISVC_WHISPER_PYTHON?.trim() || 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
  const script = fileURLToPath(new URL('../../scripts/lyric_reading.py', import.meta.url))
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let output = ''
    let error = ''
    const timeout = setTimeout(() => { child.kill(); reject(new Error('读音转换超时，可手工填写读音')) }, 30000)
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-2000) })
    child.once('error', reason => { clearTimeout(timeout); reject(reason) })
    child.once('close', code => {
      clearTimeout(timeout)
      if (code !== 0) { reject(new Error(error || '日语读音转换失败')); return }
      try { resolve(JSON.parse(output)) } catch { reject(new Error('读音返回格式无效')) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ text }))
  })
}
