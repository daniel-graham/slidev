import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getNarrationCacheSizeForTest,
  getOrCreateNarration,
  hasCachedNarration,
  markNarrationPreloadStarted,
  preloadUpcomingNarrations,
  registerNarration,
  resetNarrationCacheForTest,
} from '../utils/narration'

const request = {
  text: 'Slide narration.',
  voice: 'af_heart',
  speed: 1,
  model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  dtype: 'q8',
  device: 'wasm',
}

describe('kokoro narration cache', () => {
  beforeEach(() => {
    resetNarrationCacheForTest()
  })

  it('deduplicates concurrent generation for the same narration request', async () => {
    const generate = vi.fn(async () => ({ data: [0], sample_rate: 24_000 }))

    const first = getOrCreateNarration(request, generate)
    const second = getOrCreateNarration({ ...request }, generate)

    await expect(first).resolves.toEqual({ data: [0], sample_rate: 24_000 })
    await expect(second).resolves.toEqual({ data: [0], sample_rate: 24_000 })
    expect(generate).toHaveBeenCalledOnce()
    expect(hasCachedNarration(request)).toBe(true)
  })

  it('preloads registered upcoming slides only after narration has started', async () => {
    vi.useFakeTimers()
    const generate = vi.fn(async entry => ({ data: [entry.speed], sample_rate: 24_000 }))

    registerNarration(2, { ...request, text: 'Second slide.', speed: 1.1 })
    registerNarration(3, { ...request, text: 'Third slide.', speed: 1.2 })
    const p1 = preloadUpcomingNarrations({
      currentSlideNo: 1,
      totalSlides: 3,
      preload: 2,
      cacheSize: 8,
      generate,
    })
    await vi.advanceTimersByTimeAsync(2000)
    await p1

    expect(generate).not.toHaveBeenCalled()

    markNarrationPreloadStarted()
    const p2 = preloadUpcomingNarrations({
      currentSlideNo: 1,
      totalSlides: 3,
      preload: 2,
      cacheSize: 8,
      generate,
    })
    await vi.advanceTimersByTimeAsync(2000)
    await p2

    expect(generate).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('evicts older generated narrations when the cache is full', async () => {
    const generate = vi.fn(async entry => ({ data: [entry.speed], sample_rate: 24_000 }))

    await getOrCreateNarration({ ...request, text: 'One.' }, generate, 2)
    await getOrCreateNarration({ ...request, text: 'Two.' }, generate, 2)
    await getOrCreateNarration({ ...request, text: 'Three.' }, generate, 2)

    expect(getNarrationCacheSizeForTest()).toBe(2)
    expect(hasCachedNarration({ ...request, text: 'One.' })).toBe(false)
    expect(hasCachedNarration({ ...request, text: 'Three.' })).toBe(true)
  })
})
