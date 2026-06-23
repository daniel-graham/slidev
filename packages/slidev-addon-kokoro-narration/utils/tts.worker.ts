import { env } from '@huggingface/transformers'
import { KokoroTTS } from 'kokoro-js'

// Enforce single-threaded execution for ONNX Runtime Web to prevent deadlocks and RESULT_CODE_HUNG
// in environments without SharedArrayBuffer (e.g. headless Chrome, standard Slidev dev servers)
env.backends.onnx.numThreads = 1

let ttsPromise: Promise<KokoroTTS> | null = null
let messageChain = Promise.resolve()

async function handleMessage(event: MessageEvent) {
  const { type, payload, id } = event.data

  if (type === 'load') {
    const { request } = payload
    try {
      if (!ttsPromise) {
        ttsPromise = KokoroTTS.from_pretrained(request.model, {
          dtype: request.dtype,
          device: request.device === 'auto' ? undefined : request.device,
          progress_callback: (progressEvent: any) => {
            self.postMessage({ type: 'progress', id, payload: progressEvent })
          },
        })
      }
      await ttsPromise
      self.postMessage({ type: 'loaded', id })
    }
    catch (err: any) {
      self.postMessage({ type: 'error', id, error: err?.message || String(err) })
    }
  }
  else if (type === 'generate') {
    const { request } = payload
    try {
      if (!ttsPromise) {
        ttsPromise = KokoroTTS.from_pretrained(request.model, {
          dtype: request.dtype,
          device: request.device === 'auto' ? undefined : request.device,
          progress_callback: (progressEvent: any) => {
            self.postMessage({ type: 'progress', id, payload: progressEvent })
          },
        })
      }
      const tts = await ttsPromise
      const generated = await tts.generate(request.text, {
        voice: request.voice,
        speed: request.speed,
      })

      const samples = generated.data ?? generated.audio
      if (!samples) {
        throw new Error('Kokoro audio did not include sample data')
      }

      const floatArray = samples instanceof Float32Array ? samples : new Float32Array(samples)

      self.postMessage({
        type: 'generated',
        id,
        payload: {
          audio: floatArray,
          sampling_rate: generated.sampling_rate ?? generated.sample_rate ?? 24000,
        },
      }, [floatArray.buffer])
    }
    catch (err: any) {
      self.postMessage({ type: 'error', id, error: err?.message || String(err) })
    }
  }
  else if (type === 'terminate') {
    ttsPromise = null
    self.close()
  }
}

self.onmessage = (event: MessageEvent) => {
  messageChain = messageChain
    .then(() => handleMessage(event))
    .catch((err) => {
      console.error('TTS worker message chain error:', err)
    })
}
