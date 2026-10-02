import { describe, expect, it, vi } from 'vitest'
import { isMidiInstrument, PIANO_SAMPLES, pianoSampleForClass, prepareMidiInstrument } from './midiInstrument'

describe('MIDI instruments', () => {
  it('covers A0 to C8 with 30 distinct samples', () => {
    expect(PIANO_SAMPLES).toHaveLength(30)
    expect(new Set(PIANO_SAMPLES.map(sample => sample.file)).size).toBe(30)
    expect(PIANO_SAMPLES[0].midi).toBe(21)
    expect(PIANO_SAMPLES.at(-1)?.midi).toBe(108)
  })
  it('uses nearest samples and preserves half-semitone MIDI-P precision', () => {
    expect(pianoSampleForClass(120)).toEqual({ midi: 60, file: 'C4.mp3', playbackRate: 1 })
    expect(pianoSampleForClass(121).playbackRate).toBeCloseTo(2 ** (0.5 / 12))
    expect(pianoSampleForClass(138)).toEqual({ midi: 69, file: 'A4.mp3', playbackRate: 1 })
    expect(pianoSampleForClass(0).file).toBe('A0.mp3')
    expect(pianoSampleForClass(254).file).toBe('C8.mp3')
  })
  it('does not load assets for synthesized instruments', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    try {
      await prepareMidiInstrument({} as BaseAudioContext, 'soft')
      await prepareMidiInstrument({} as BaseAudioContext, 'square')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally { fetchMock.mockRestore() }
  })
  it('deduplicates piano loading and allows retry after an HTTP error', async () => {
    const context = { decodeAudioData: vi.fn(async () => ({})) } as unknown as BaseAudioContext
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)
    try {
      await expect(prepareMidiInstrument(context, 'piano')).rejects.toThrow('钢琴采样加载失败')
      fetchMock.mockClear().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) } as Response)
      await Promise.all([prepareMidiInstrument(context, 'piano'), prepareMidiInstrument(context, 'piano')])
      await prepareMidiInstrument(context, 'piano')
      expect(fetchMock).toHaveBeenCalledTimes(30)
      expect(context.decodeAudioData).toHaveBeenCalledTimes(30)
    } finally { fetchMock.mockRestore() }
  })
  it('rejects unknown preference values', () => {
    expect(isMidiInstrument('piano')).toBe(true)
    expect(isMidiInstrument('square')).toBe(true)
    expect(isMidiInstrument('guitar')).toBe(false)
  })
})
