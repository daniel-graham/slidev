import { describe, expect, it, vi } from 'vitest'
import { createAudioObjectUrl, createWavBlob, revokeAudioObjectUrl } from '../utils/audio'

describe('kokoro narration audio helpers', () => {
  it('converts Kokoro RawAudio data into a 16-bit PCM WAV blob', async () => {
    const blob = createWavBlob({
      data: new Float32Array([-2, -0.5, 0, 0.5, 2]),
      sampling_rate: 24_000,
    })

    expect(blob.type).toBe('audio/wav')

    const buffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const text = new TextDecoder().decode(bytes)
    const view = new DataView(buffer)

    expect(text.slice(0, 4)).toBe('RIFF')
    expect(text.slice(8, 12)).toBe('WAVE')
    expect(text.slice(12, 16)).toBe('fmt ')
    expect(text.slice(36, 40)).toBe('data')
    expect(view.getUint32(24, true)).toBe(24_000)
    expect(view.getUint32(40, true)).toBe(10)
    expect(view.getInt16(44, true)).toBe(-32_768)
    expect(view.getInt16(46, true)).toBe(-16_384)
    expect(view.getInt16(48, true)).toBe(0)
    expect(view.getInt16(50, true)).toBe(16_383)
    expect(view.getInt16(52, true)).toBe(32_767)
  })

  it('creates and revokes browser object URLs through injected globals', () => {
    const createObjectURL = vi.fn(() => 'blob:kokoro')
    const revokeObjectURL = vi.fn()
    const env = {
      Blob,
      URL: { createObjectURL, revokeObjectURL },
    }

    const url = createAudioObjectUrl({ data: [0], sample_rate: 16_000 }, env)
    revokeAudioObjectUrl(url, env)

    expect(url).toBe('blob:kokoro')
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio/wav' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:kokoro')
  })

  it('accepts the Transformers RawAudio audio property shape', async () => {
    const blob = createWavBlob({
      audio: new Float32Array([0.25]),
      sampling_rate: 22_050,
    })

    const view = new DataView(await blob.arrayBuffer())

    expect(view.getUint32(24, true)).toBe(22_050)
    expect(view.getInt16(44, true)).toBe(8191)
  })

  it('prefers RawAudio toBlob when available', () => {
    const blob = new Blob(['wav'], { type: 'audio/wav' })
    const toBlob = vi.fn(() => blob)

    expect(createWavBlob({ toBlob })).toBe(blob)
    expect(toBlob).toHaveBeenCalledOnce()
  })
})
