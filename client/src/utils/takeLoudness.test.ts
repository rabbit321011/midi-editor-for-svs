import { describe, expect, it } from 'vitest'
import { audioRmsAndPeak, channelsToFloatWav, planTakeLoudness } from './takeLoudness'

describe('Take RMS alignment', () => {
  it('computes the ratio from the same effective interval without including Guide tail', () => {
    const guide = [new Float32Array([0.4, -0.4, 0.9, 0.9])]
    const take = [new Float32Array([0.2, -0.2])]
    const plan = planTakeLoudness(guide, take, 2)
    expect(plan.gain).toBeCloseTo(2)
    expect(plan.sampleCount).toBe(2)
    expect(plan.forcedClipping).toBe(false)
    expect(guide[0][2]).toBeCloseTo(0.9)
    expect(take[0][0]).toBeCloseTo(0.2)
  })

  it('measures stereo energy without cancellation from opposite phase channels', () => {
    const channels = [new Float32Array([0.4, -0.4]), new Float32Array([-0.4, 0.4])]
    expect(audioRmsAndPeak(channels, 2).rms).toBeCloseTo(0.4)
  })

  it('flags forced clipping rather than silently reducing the requested gain', () => {
    const take = new Float32Array(100)
    take[0] = 0.9
    const plan = planTakeLoudness([new Float32Array(100).fill(0.4)], [take], 100)
    expect(plan.gain).toBeGreaterThan(4)
    expect(plan.forcedClipping).toBe(true)
  })

  it('skips near-silent audio and rejects empty or nonfinite input', () => {
    expect(() => planTakeLoudness([new Float32Array([0.4])], [new Float32Array([0])], 1)).toThrow('Take 接近静音')
    expect(() => planTakeLoudness([new Float32Array([0])], [new Float32Array([0.4])], 1)).toThrow('Guide')
    expect(() => planTakeLoudness([], [new Float32Array([0.4])], 1)).toThrow()
    expect(() => planTakeLoudness([new Float32Array([NaN])], [new Float32Array([0.4])], 1)).toThrow('无效')
  })

  it('keeps channel count, duration and original samples while clipping a processed copy', async () => {
    const channels = [new Float32Array([0.8, -0.8]), new Float32Array([0.2, -0.2])]
    const blob = channelsToFloatWav(channels, 44100, 2, true)
    const view = new DataView(await blob.arrayBuffer())
    expect(view.getUint16(20, true)).toBe(3)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint32(40, true)).toBe(16)
    expect(view.getFloat32(44, true)).toBe(1)
    expect(view.getFloat32(48, true)).toBeCloseTo(0.4)
    expect(view.getFloat32(52, true)).toBe(-1)
    expect(channels[0][0]).toBeCloseTo(0.8)
    expect(view.getFloat32(56, true)).toBeCloseTo(-0.4)
  })
})
