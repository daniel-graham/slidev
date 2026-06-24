export interface KokoroRawAudio {
  audio?: ArrayLike<number>
  data?: ArrayLike<number>
  sampling_rate?: number
  sample_rate?: number
  toBlob?: () => Blob
}

export interface BrowserAudioUrlEnv {
  Blob: typeof Blob
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
}

const DEFAULT_SAMPLE_RATE = 24_000
const WAV_HEADER_BYTES = 44
const PCM_BYTES_PER_SAMPLE = 2

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1)
    view.setUint8(offset + index, value.charCodeAt(index))
}

function toPcm16(sample: number) {
  const clamped = Math.max(-1, Math.min(1, sample))
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF
}

function getSampleRate(audio: KokoroRawAudio) {
  const sampleRate = audio.sampling_rate ?? audio.sample_rate ?? DEFAULT_SAMPLE_RATE
  if (!Number.isFinite(sampleRate) || sampleRate <= 0)
    throw new Error(`Invalid Kokoro sample rate: ${sampleRate}`)
  return sampleRate
}

function getSamples(audio: KokoroRawAudio) {
  const samples = audio.data ?? audio.audio
  if (!samples)
    throw new Error('Kokoro audio did not include sample data')
  return samples
}

export function createWavBlob(audio: KokoroRawAudio, BlobCtor: typeof Blob = globalThis.Blob) {
  if (!BlobCtor)
    throw new Error('Blob is not available in this environment')
  if (typeof audio.toBlob === 'function')
    return audio.toBlob()

  const sampleRate = getSampleRate(audio)
  const samples = getSamples(audio)
  const sampleCount = samples.length
  const dataBytes = sampleCount * PCM_BYTES_PER_SAMPLE
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * PCM_BYTES_PER_SAMPLE, true)
  view.setUint16(32, PCM_BYTES_PER_SAMPLE, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let index = 0; index < sampleCount; index += 1)
    view.setInt16(WAV_HEADER_BYTES + index * PCM_BYTES_PER_SAMPLE, toPcm16(samples[index]), true)

  return new BlobCtor([buffer], { type: 'audio/wav' })
}

export function createAudioObjectUrl(audio: KokoroRawAudio, env: BrowserAudioUrlEnv = globalThis) {
  return env.URL.createObjectURL(createWavBlob(audio, env.Blob))
}

export function revokeAudioObjectUrl(url: string, env: BrowserAudioUrlEnv = globalThis) {
  env.URL.revokeObjectURL(url)
}
