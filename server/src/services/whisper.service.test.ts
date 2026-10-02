import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { WebSocket } from 'ws'
import { resolveSofaRuntime, runWhisper } from './whisper.service'

test('Japanese SOFA runtime rejects explicit paths that do not contain the exact resources', () => {
  assert.throws(
    () => resolveSofaRuntime({
      AISVC_SOFA_PYTHON: 'Z:/missing/sofa/python.exe',
      AISVC_SOFA_REPO: 'Z:/missing/Voicebank2DiffSinger-main',
      AISVC_SOFA_JPN_TEST2_PLUS_CKPT: 'Z:/missing/JPN_Test2_Plus.ckpt',
    }),
    /SOFA Python not found/,
  )
})

test('Japanese SOFA runtime accepts the Voicebank2DiffSinger JPN_Test2_Plus layout', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-sofa-runtime-'))
  try {
    const python = path.join(tempDir, 'python.exe')
    const repo = path.join(tempDir, 'Voicebank2DiffSinger-main')
    const checkpoint = path.join(tempDir, 'JPN_Test2_Plus.ckpt')
    fs.mkdirSync(path.join(repo, 'src', 'SOFA'), { recursive: true })
    fs.writeFileSync(python, '')
    fs.writeFileSync(checkpoint, '')

    assert.deepEqual(resolveSofaRuntime({
      AISVC_SOFA_PYTHON: python,
      AISVC_SOFA_REPO: repo,
      AISVC_SOFA_JPN_TEST2_PLUS_CKPT: checkpoint,
    }), { python, repo, checkpoint })
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('Whisper pipeline contains asynchronous runner failures and reports their diagnostics', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-whisper-failure-'))
  const keys = ['AISVC_WHISPER_PYTHON', 'AISVC_SOFA_PYTHON', 'AISVC_SOFA_REPO', 'AISVC_SOFA_JPN_TEST2_PLUS_CKPT'] as const
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const messages: Array<{ type: string; message?: string }> = []
  try {
    fs.mkdirSync(path.join(tempDir, 'src', 'SOFA'), { recursive: true })
    const checkpoint = path.join(tempDir, 'test.ckpt')
    fs.writeFileSync(checkpoint, '')
    // Node cannot execute the Python runner. This exercises a real child exit
    // without loading a model, accessing the network, or using the GPU.
    process.env.AISVC_WHISPER_PYTHON = process.execPath
    process.env.AISVC_SOFA_PYTHON = process.execPath
    process.env.AISVC_SOFA_REPO = tempDir
    process.env.AISVC_SOFA_JPN_TEST2_PLUS_CKPT = checkpoint
    const ws = { send: (payload: string) => messages.push(JSON.parse(payload)) } as unknown as WebSocket
    await assert.doesNotReject(runWhisper({
      inputWav: path.join(tempDir, 'unused.wav'),
      outputDir: tempDir,
      outputName: 'renamed_segment',
      language: 'ja', vad: true, device: 'cuda', computeType: 'float16',
    }, ws))
    const error = messages.filter(message => message.type === 'error').at(-1)
    assert.match(error?.message ?? '', /Whisper exited with code/)
    assert.match(error?.message ?? '', /SyntaxError|ERR_UNKNOWN_FILE_EXTENSION/)
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
