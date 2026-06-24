import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUnlockedAudioElement, startAudioPlayback } from '../utils/playback'

class FakeAudio {
  currentTime = 0
  pause = vi.fn()
  play = vi.fn(async () => {})
  playsInline = false
  preload = ''
  src = ''

  constructor(src: string) {
    this.src = src
  }
}

describe('kokoro narration playback unlock', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('primes a browser audio element for later narration playback', async () => {
    vi.stubGlobal('Audio', FakeAudio)

    const audio = createUnlockedAudioElement() as unknown as FakeAudio
    await Promise.resolve()

    expect(audio.preload).toBe('auto')
    expect(audio.playsInline).toBe(true)
    expect(audio.play).toHaveBeenCalledOnce()
    expect(audio.pause).toHaveBeenCalledOnce()
  })

  it('does not pause the audio element after a real source is attached', async () => {
    let resolvePlay: (() => void) | undefined
    class SlowAudio extends FakeAudio {
      override play = vi.fn(() => new Promise<void>((resolve) => {
        resolvePlay = resolve
      }))
    }
    vi.stubGlobal('Audio', SlowAudio)

    const audio = createUnlockedAudioElement() as unknown as SlowAudio
    audio.src = 'blob:generated-narration'
    resolvePlay?.()
    await Promise.resolve()

    expect(audio.pause).not.toHaveBeenCalled()
  })

  it('reports playback before the browser play promise settles', async () => {
    let resolvePlay: (() => void) | undefined
    class SlowAudio extends FakeAudio {
      override play = vi.fn(() => new Promise<void>((resolve) => {
        resolvePlay = resolve
      }))
    }

    const audio = new SlowAudio('blob:generated-narration')
    const onPlaying = vi.fn()
    const playback = startAudioPlayback(audio as unknown as HTMLAudioElement, onPlaying)

    expect(audio.play).toHaveBeenCalledOnce()
    expect(onPlaying).toHaveBeenCalledOnce()

    resolvePlay?.()
    await playback
  })
})
