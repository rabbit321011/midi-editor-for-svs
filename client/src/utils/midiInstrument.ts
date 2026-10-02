export type MidiInstrument = 'piano' | 'soft' | 'square'

export const MIDI_INSTRUMENT_OPTIONS: Array<{ label: string; value: MidiInstrument }> = [
  { label: '钢琴', value: 'piano' },
  { label: '柔和电子音', value: 'soft' },
  { label: '方波', value: 'square' },
]

export function isMidiInstrument(value: unknown): value is MidiInstrument {
  return value === 'piano' || value === 'soft' || value === 'square'
}

export const PIANO_SAMPLES = [
  { midi: 21, file: 'A0.mp3' },
  ...Array.from({ length: 7 }, (_, i) => [
    { midi: 24 + i * 12, file: `C${i + 1}.mp3` },
    { midi: 27 + i * 12, file: `Ds${i + 1}.mp3` },
    { midi: 30 + i * 12, file: `Fs${i + 1}.mp3` },
    { midi: 33 + i * 12, file: `A${i + 1}.mp3` },
  ]).flat(),
  { midi: 108, file: 'C8.mp3' },
]

export function pianoSampleForClass(midiClass: number) {
  const midi = midiClass / 2
  const sample = PIANO_SAMPLES.reduce((best, item) =>
    Math.abs(item.midi - midi) < Math.abs(best.midi - midi) ? item : best)
  return { ...sample, playbackRate: 2 ** ((midi - sample.midi) / 12) }
}

const pianoBuffers = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>()
const pianoLoads = new WeakMap<BaseAudioContext, Promise<void>>()

export async function prepareMidiInstrument(context: BaseAudioContext, instrument: MidiInstrument): Promise<void> {
  if (instrument !== 'piano' || pianoBuffers.has(context)) return
  let pending = pianoLoads.get(context)
  if (!pending) {
    pending = (async () => {
      const entries = await Promise.all(PIANO_SAMPLES.map(async sample => {
        const response = await fetch(`/instruments/salamander/${sample.file}`)
        if (!response.ok) throw new Error(`钢琴采样加载失败：${sample.file} (${response.status})`)
        return [sample.file, await context.decodeAudioData(await response.arrayBuffer())] as const
      }))
      pianoBuffers.set(context, new Map(entries))
    })().finally(() => pianoLoads.delete(context))
    pianoLoads.set(context, pending)
  }
  await pending
}

export interface MidiVoice {
  output: GainNode
  readonly ended: boolean
  stop(): void
}

export function scheduleMidiTone(
  context: BaseAudioContext, instrument: MidiInstrument, midiClass: number,
  startTime: number, duration: number, volume = 1,
): MidiVoice {
  if (!Number.isInteger(midiClass) || midiClass < 0 || midiClass > 254) throw new Error('Invalid MIDI-P pitch')
  const start = Math.max(context.currentTime, startTime)
  const end = start + Math.max(0.012, duration)
  const output = context.createGain()
  output.gain.value = Math.max(0, volume)
  const envelope = context.createGain()
  const level = instrument === 'piano' ? 0.65 : instrument === 'square' ? 0.09 : 0.16
  const attack = Math.min(end, start + 0.008)
  const release = Math.max(attack, end - 0.025)
  envelope.gain.setValueAtTime(0, start)
  envelope.gain.linearRampToValueAtTime(level, attack)
  envelope.gain.setValueAtTime(level, release)
  envelope.gain.linearRampToValueAtTime(0, end)
  envelope.connect(output).connect(context.destination)
  const sources: AudioScheduledSourceNode[] = []
  const harmonics: GainNode[] = []
  if (instrument === 'piano') {
    const sample = pianoSampleForClass(midiClass)
    const buffer = pianoBuffers.get(context)?.get(sample.file)
    if (!buffer) {
      envelope.disconnect()
      output.disconnect()
      throw new Error('钢琴采样尚未加载')
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = sample.playbackRate
    source.connect(envelope)
    sources.push(source)
  } else {
    const frequency = 440 * 2 ** ((midiClass / 2 - 69) / 12)
    for (const [multiple, level] of instrument === 'soft' ? [[1, 1], [2, 0.24]] : [[1, 1]]) {
      const oscillator = context.createOscillator()
      oscillator.type = instrument === 'square' ? 'square' : 'sine'
      oscillator.frequency.value = frequency * multiple
      const harmonic = context.createGain()
      harmonic.gain.value = level
      oscillator.connect(harmonic).connect(envelope)
      sources.push(oscillator)
      harmonics.push(harmonic)
    }
  }
  let remaining = sources.length
  for (const source of sources) {
    source.onended = () => {
      source.disconnect()
      if (--remaining === 0) {
        for (const gain of harmonics) gain.disconnect()
        envelope.disconnect()
        output.disconnect()
      }
    }
    source.start(start)
    source.stop(end + 0.005)
  }
  return { output, get ended() { return remaining === 0 }, stop() { for (const source of sources) { try { source.stop() } catch {} } } }
}
