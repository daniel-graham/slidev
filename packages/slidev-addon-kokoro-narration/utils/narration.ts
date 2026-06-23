import type { KokoroRawAudio } from './audio'

export interface NarrationRequest {
  text: string
  voice: string
  speed: number
  model: string
  dtype: string
  device: string
}

export type GenerateNarration = (request: NarrationRequest) => Promise<KokoroRawAudio>

const DEFAULT_CACHE_SIZE = 8

let preloadStarted = false
const registeredNarrations = new Map<number, NarrationRequest>()
const generatedNarrations = new Map<string, Promise<KokoroRawAudio>>()
const cacheOrder: string[] = []

function normalizePositiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export function getNarrationCacheKey(request: NarrationRequest) {
  return JSON.stringify([
    request.model,
    request.dtype,
    request.device,
    request.voice,
    request.speed,
    request.text,
  ])
}

function forgetCacheKey(key: string) {
  generatedNarrations.delete(key)
  const index = cacheOrder.indexOf(key)
  if (index >= 0)
    cacheOrder.splice(index, 1)
}

function touchCacheKey(key: string, maxEntries: number) {
  const existingIndex = cacheOrder.indexOf(key)
  if (existingIndex >= 0)
    cacheOrder.splice(existingIndex, 1)
  cacheOrder.push(key)

  const limit = normalizePositiveInteger(maxEntries, DEFAULT_CACHE_SIZE)
  while (cacheOrder.length > limit) {
    const evictedKey = cacheOrder.shift()
    if (evictedKey)
      generatedNarrations.delete(evictedKey)
  }
}

let currentPreloadSlideNo = 0
let preloadRunId = 0

/**
 * Marks that narration preloading has been started.
 */
export function markNarrationPreloadStarted() {
  preloadStarted = true
}

/**
 * Checks if narration preloading has been started.
 *
 * @returns True if preloading is active.
 */
export function hasNarrationPreloadStarted() {
  return preloadStarted
}

/**
 * Stops the narration preloading process.
 *
 * Cancels further background audio generations.
 */
export function stopNarrationPreload() {
  preloadStarted = false
  preloadRunId += 1
}

export function registerNarration(slideNo: number, request: NarrationRequest) {
  if (!Number.isFinite(slideNo) || slideNo <= 0 || !request.text.trim())
    return () => {}

  const cacheKey = getNarrationCacheKey(request)
  registeredNarrations.set(slideNo, request)

  return () => {
    const current = registeredNarrations.get(slideNo)
    if (current && getNarrationCacheKey(current) === cacheKey)
      registeredNarrations.delete(slideNo)
  }
}

export function hasCachedNarration(request: NarrationRequest) {
  return generatedNarrations.has(getNarrationCacheKey(request))
}

export function getOrCreateNarration(
  request: NarrationRequest,
  generate: GenerateNarration,
  maxEntries = DEFAULT_CACHE_SIZE,
) {
  const cacheKey = getNarrationCacheKey(request)
  const cached = generatedNarrations.get(cacheKey)
  if (cached) {
    touchCacheKey(cacheKey, maxEntries)
    return cached
  }

  const generated = generate(request).catch((error) => {
    forgetCacheKey(cacheKey)
    throw error
  })
  generatedNarrations.set(cacheKey, generated)
  touchCacheKey(cacheKey, maxEntries)
  return generated
}

/**
 * Preloads registered upcoming slide narrations sequentially.
 *
 * Spaces out generations with a 1000ms delay to yield CPU back to the main thread.
 * Checks for slide changes and cancellation to terminate early.
 *
 * @param options Configuration for preloading.
 * @returns A promise that resolves when preloading is done or cancelled.
 */
export async function preloadUpcomingNarrations(options: {
  currentSlideNo: number
  totalSlides: number
  preload: number
  cacheSize: number
  generate: GenerateNarration
}) {
  if (!preloadStarted)
    return

  currentPreloadSlideNo = options.currentSlideNo
  const mySlideNo = options.currentSlideNo
  const runId = preloadRunId += 1

  const preloadCount = normalizePositiveInteger(options.preload, 0)
  const lastSlide = Math.min(options.totalSlides, options.currentSlideNo + preloadCount)

  for (let slideNo = options.currentSlideNo + 1; slideNo <= lastSlide; slideNo += 1) {
    // Yield to the browser main thread before generating the next slide's audio
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Abort if preloading was stopped or the user navigated to another slide
    if (!preloadStarted || currentPreloadSlideNo !== mySlideNo || runId !== preloadRunId)
      break

    const request = registeredNarrations.get(slideNo)
    if (request) {
      try {
        await getOrCreateNarration(request, options.generate, options.cacheSize)
      } catch (err) {
        console.warn(`Failed to preload narration for slide ${slideNo}:`, err)
      }
    }
  }
}

export function resetNarrationCacheForTest() {
  preloadStarted = false
  registeredNarrations.clear()
  generatedNarrations.clear()
  cacheOrder.splice(0)
}

export function getNarrationCacheSizeForTest() {
  return generatedNarrations.size
}
