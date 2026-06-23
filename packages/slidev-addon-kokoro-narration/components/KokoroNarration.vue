<script setup lang="ts">
import type { KokoroRawAudio } from '../utils/audio'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { createAudioObjectUrl, revokeAudioObjectUrl } from '../utils/audio'

type Device = 'auto' | 'wasm' | 'webgpu' | 'cpu'
type DType = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
type Status = 'idle' | 'loading' | 'generating' | 'playing' | 'error'
interface KokoroTts {
  generate: (text: string, options: { voice: string, speed: number }) => Promise<KokoroRawAudio>
}

const props = withDefaults(defineProps<{
  text?: string
  voice?: string
  speed?: number
  model?: string
  dtype?: DType
  device?: Device
  label?: string
  autoplay?: boolean
}>(), {
  text: '',
  voice: 'af_heart',
  speed: 1,
  model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  dtype: 'q8',
  device: 'wasm',
  label: 'Narrate',
  autoplay: false,
})

const status = ref<Status>('idle')
const error = ref('')
const progress = ref(0)
const audioUrl = ref('')
const narrationText = computed(() => props.text.trim())
const isBusy = computed(() => status.value === 'loading' || status.value === 'generating')
const buttonLabel = computed(() => {
  if (status.value === 'loading')
    return progress.value > 0 ? `Loading ${Math.round(progress.value)}%` : 'Loading'
  if (status.value === 'generating')
    return 'Generating'
  if (status.value === 'playing')
    return 'Stop'
  if (status.value === 'error')
    return 'Retry'
  return props.label
})

let ttsPromise: Promise<KokoroTts> | undefined
let audio: HTMLAudioElement | undefined

function releaseAudio() {
  if (audio) {
    audio.onended = null
    audio.onerror = null
    audio.pause()
    audio.src = ''
    audio = undefined
  }
  if (audioUrl.value) {
    revokeAudioObjectUrl(audioUrl.value)
    audioUrl.value = ''
  }
}

function updateProgress(event: unknown) {
  if (event && typeof event === 'object' && 'progress' in event && typeof event.progress === 'number')
    progress.value = Math.max(progress.value, event.progress)
}

async function loadTts(): Promise<KokoroTts> {
  if (!ttsPromise) {
    status.value = 'loading'
    const { KokoroTTS } = await import('kokoro-js')
    ttsPromise = KokoroTTS
      .from_pretrained(props.model, {
        dtype: props.dtype,
        device: props.device === 'auto' ? undefined : props.device,
        progress_callback: updateProgress,
      })
      .then(tts => tts as unknown as KokoroTts)
  }
  return ttsPromise
}

async function play() {
  if (!narrationText.value || isBusy.value)
    return

  error.value = ''
  releaseAudio()

  try {
    const tts = await loadTts()
    status.value = 'generating'
    const generated = await tts.generate(narrationText.value, {
      voice: props.voice,
      speed: props.speed,
    })

    audioUrl.value = createAudioObjectUrl(generated)
    audio = new Audio(audioUrl.value)
    audio.onended = () => {
      releaseAudio()
      status.value = 'idle'
    }
    audio.onerror = () => {
      releaseAudio()
      status.value = 'error'
      error.value = 'Playback failed'
    }
    await audio.play()
    status.value = 'playing'
  }
  catch (err) {
    releaseAudio()
    status.value = 'error'
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function toggle() {
  if (status.value === 'playing') {
    releaseAudio()
    status.value = 'idle'
    return
  }
  void play()
}

onMounted(() => {
  if (props.autoplay)
    void play()
})

onBeforeUnmount(releaseAudio)
</script>

<template>
  <button
    class="slidev-kokoro-narration"
    type="button"
    :disabled="isBusy || !narrationText"
    :aria-busy="isBusy"
    :aria-label="buttonLabel"
    :title="error || buttonLabel"
    @click="toggle"
  >
    <span class="slidev-kokoro-narration__mark" :data-status="status" />
    <span>{{ buttonLabel }}</span>
  </button>
</template>

<style scoped>
.slidev-kokoro-narration {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 50;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 7.5rem;
  height: 2.35rem;
  padding: 0 0.85rem;
  border: 1px solid rgb(148 163 184 / 40%);
  border-radius: 999px;
  color: rgb(15 23 42);
  background: rgb(255 255 255 / 88%);
  box-shadow: 0 10px 28px rgb(15 23 42 / 18%);
  font:
    600 0.82rem/1 system-ui,
    sans-serif;
  cursor: pointer;
  backdrop-filter: blur(10px);
}

.slidev-kokoro-narration:disabled {
  cursor: wait;
  opacity: 0.68;
}

.slidev-kokoro-narration__mark {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  background: rgb(71 85 105);
}

.slidev-kokoro-narration__mark[data-status='playing'] {
  background: rgb(22 163 74);
}

.slidev-kokoro-narration__mark[data-status='loading'],
.slidev-kokoro-narration__mark[data-status='generating'] {
  background: rgb(37 99 235);
  animation: slidev-kokoro-pulse 1s ease-in-out infinite;
}

.slidev-kokoro-narration__mark[data-status='error'] {
  background: rgb(220 38 38);
}

@keyframes slidev-kokoro-pulse {
  50% {
    transform: scale(0.72);
    opacity: 0.45;
  }
}
</style>
