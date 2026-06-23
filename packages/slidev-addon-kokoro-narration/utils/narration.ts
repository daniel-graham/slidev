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

export function markNarrationPreloadStarted() {
  preloadStarted = true
}

export function hasNarrationPreloadStarted() {
  return preloadStarted
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

export function preloadUpcomingNarrations(options: {
  currentSlideNo: number
  totalSlides: number
  preload: number
  cacheSize: number
  generate: GenerateNarration
}) {
  if (!preloadStarted)
    return

  const preloadCount = normalizePositiveInteger(options.preload, 0)
  const lastSlide = Math.min(options.totalSlides, options.currentSlideNo + preloadCount)
  for (let slideNo = options.currentSlideNo + 1; slideNo <= lastSlide; slideNo += 1) {
    const request = registeredNarrations.get(slideNo)
    if (request)
      void getOrCreateNarration(request, options.generate, options.cacheSize).catch(() => {})
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
