import type { KokoroRawAudio } from './audio'
import type { NarrationRequest } from './narration'

interface KokoroTts {
  generate: (text: string, options: { voice: string, speed: number }) => Promise<KokoroRawAudio>
}

const ttsPromises = new Map<string, Promise<KokoroTts>>()

function getModelCacheKey(request: NarrationRequest) {
  return JSON.stringify([
    request.model,
    request.dtype,
    request.device,
  ])
}

export async function loadKokoroTts(
  request: NarrationRequest,
  progressCallback?: (event: unknown) => void,
): Promise<KokoroTts> {
  const cacheKey = getModelCacheKey(request)
  let ttsPromise = ttsPromises.get(cacheKey)
  if (!ttsPromise) {
    const { KokoroTTS } = await import('kokoro-js')
    ttsPromise = KokoroTTS
      .from_pretrained(request.model, {
        dtype: request.dtype,
        device: request.device === 'auto' ? undefined : request.device,
        progress_callback: progressCallback,
      })
      .then(tts => tts as unknown as KokoroTts)
    ttsPromises.set(cacheKey, ttsPromise)
  }
  return ttsPromise
}

export async function generateKokoroNarration(
  request: NarrationRequest,
  progressCallback?: (event: unknown) => void,
) {
  const tts = await loadKokoroTts(request, progressCallback)
  return tts.generate(request.text, {
    voice: request.voice,
    speed: request.speed,
  })
}
