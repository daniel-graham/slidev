import type { KokoroRawAudio } from './audio'
import type { NarrationRequest } from './narration'
// @ts-expect-error Vite worker import query
import TtsWorker from './tts.worker?worker'

interface WorkerRequest {
  resolve: (value: any) => void
  reject: (reason: any) => void
  progress?: (event: any) => void
}

let worker: Worker | null = null
const activeRequests = new Map<string, WorkerRequest>()
let nextRequestId = 0
let loadPromise: Promise<void> | null = null
let loadedConfigKey = ''

function getConfigKey(request: NarrationRequest) {
  return `${request.model}|${request.dtype}|${request.device}`
}

function initWorkerListener(w: Worker) {
  w.onmessage = (event: MessageEvent) => {
    const { type, id, payload, error } = event.data
    const req = activeRequests.get(id)
    if (!req)
      return

    if (type === 'progress') {
      if (req.progress)
        req.progress(payload)
    }
    else if (type === 'loaded') {
      req.resolve(undefined)
      activeRequests.delete(id)
    }
    else if (type === 'generated') {
      req.resolve(payload)
      activeRequests.delete(id)
    }
    else if (type === 'error') {
      req.reject(new Error(error))
      activeRequests.delete(id)
    }
  }
  w.onerror = (err) => {
    console.error('TTS Worker error:', err)
  }
}

function getWorker() {
  if (!worker) {
    worker = new TtsWorker() as Worker
    initWorkerListener(worker)
  }
  return worker
}

function postWorkerMessage(type: 'load' | 'generate', request: NarrationRequest, progressCallback?: (event: unknown) => void) {
  const w = getWorker()
  const id = `${type}_${nextRequestId++}`
  return new Promise<any>((resolve, reject) => {
    activeRequests.set(id, { resolve, reject, progress: progressCallback })
    w.postMessage({ type, id, payload: { request } })
  })
}

/**
 * Terminates the Kokoro TTS worker and clears pending requests.
 */
export function terminateKokoroWorker() {
  if (!worker)
    return

  for (const [, req] of activeRequests)
    req.reject(new Error('Kokoro worker terminated'))
  activeRequests.clear()
  loadPromise = null
  loadedConfigKey = ''
  worker.postMessage({ type: 'terminate', id: 'terminate', payload: {} })
  worker.terminate()
  worker = null
}

/**
 * Loads the Kokoro TTS model inside the Web Worker.
 *
 * @param request The narration request parameters defining the model setup.
 * @param progressCallback Optional callback to receive model loading progress updates.
 * @returns A promise that resolves when the model is loaded.
 */
export async function loadKokoroTts(
  request: NarrationRequest,
  progressCallback?: (event: unknown) => void,
): Promise<void> {
  if (typeof window !== 'undefined' && (window.location.search.includes('mock=true') || (window as any).__KOKORO_MOCK__)) {
    if (progressCallback)
      progressCallback({ progress: 100 })
    return Promise.resolve()
  }

  const configKey = getConfigKey(request)
  if (loadPromise && loadedConfigKey === configKey)
    return loadPromise

  loadPromise = postWorkerMessage('load', request, progressCallback).then(() => {
    loadedConfigKey = configKey
  }).catch((err) => {
    loadPromise = null
    loadedConfigKey = ''
    throw err
  })
  return loadPromise
}

/**
 * Generates Kokoro speech synthesis audio using the Web Worker.
 *
 * @param request The narration request parameters defining the model and text.
 * @param progressCallback Optional callback to receive model loading/generation progress updates.
 * @returns A promise that resolves to the generated KokoroRawAudio.
 */
export async function generateKokoroNarration(
  request: NarrationRequest,
  progressCallback?: (event: unknown) => void,
): Promise<KokoroRawAudio> {
  if (typeof window !== 'undefined' && (window.location.search.includes('mock=true') || (window as any).__KOKORO_MOCK__)) {
    if (progressCallback) {
      for (let p = 10; p <= 100; p += 30) {
        await new Promise(resolve => setTimeout(resolve, 50))
        progressCallback({ progress: p })
      }
    }
    return {
      audio: new Float32Array(24000),
      sampling_rate: 24000,
    }
  }

  return postWorkerMessage('generate', request, progressCallback)
}
