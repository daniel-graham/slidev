<script setup lang="ts">
import type { NarrationRequest } from '../utils/narration'
import { useSlideContext } from '@slidev/client/context.ts'
import { computed, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue'
import { createAudioObjectUrl, revokeAudioObjectUrl } from '../utils/audio'
import {
  getOrCreateNarration,
  hasCachedNarration,
  markNarrationPreloadStarted,
  preloadUpcomingNarrations,
  registerNarration,
} from '../utils/narration'
import { createUnlockedAudioElement } from '../utils/playback'
import { generateKokoroNarration } from '../utils/tts'

type Device = 'auto' | 'wasm' | 'webgpu' | 'cpu'
type DType = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
type Status = 'idle' | 'loading' | 'generating' | 'playing' | 'error'

const props = withDefaults(defineProps<{
  text?: string
  voice?: string
  speed?: number
  model?: string
  dtype?: DType
  device?: Device
  label?: string
  autoplay?: boolean
  preload?: number
  cacheSize?: number
}>(), {
  text: '',
  voice: 'af_heart',
  speed: 1,
  model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  dtype: 'q8',
  device: 'wasm',
  label: 'Narrate',
  autoplay: false,
  preload: 2,
  cacheSize: 8,
})

const { $nav, $page, $route } = useSlideContext()
const status = ref<Status>('idle')
const error = ref('')
const progress = ref(0)
const audioUrl = ref('')
const narrationText = computed(() => props.text.trim())
const slideNo = computed(() => $route?.no ?? unref($page))
const activeSlideNo = computed(() => $nav.value.currentSlideNo)
const isCurrentSlide = computed(() => slideNo.value === activeSlideNo.value)
const narrationRequest = computed<NarrationRequest>(() => ({
  text: narrationText.value,
  voice: props.voice,
  speed: props.speed,
  model: props.model,
  dtype: props.dtype,
  device: props.device,
}))
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

let audio: HTMLAudioElement | undefined
let unregisterNarration = () => {}
let playToken = 0

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

function preloadUpcoming() {
  if (!isCurrentSlide.value)
    return

  preloadUpcomingNarrations({
    currentSlideNo: slideNo.value,
    totalSlides: $nav.value.total,
    preload: props.preload,
    cacheSize: props.cacheSize,
    generate: request => generateKokoroNarration(request),
  })
}

async function play() {
  if (!narrationText.value || isBusy.value)
    return

  error.value = ''
  progress.value = 0
  releaseAudio()
  audio = createUnlockedAudioElement()
  const currentPlayToken = playToken += 1

  try {
    const request = narrationRequest.value
    status.value = hasCachedNarration(request) ? 'generating' : 'loading'
    const generated = await getOrCreateNarration(
      request,
      async (entry) => {
        const generatedAudio = await generateKokoroNarration(entry, updateProgress)
        if (currentPlayToken === playToken && isCurrentSlide.value)
          status.value = 'generating'
        return generatedAudio
      },
      props.cacheSize,
    )

    if (currentPlayToken !== playToken || !isCurrentSlide.value) {
      status.value = 'idle'
      return
    }

    audioUrl.value = createAudioObjectUrl(generated)
    audio.src = audioUrl.value
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
    if (currentPlayToken !== playToken || !isCurrentSlide.value) {
      releaseAudio()
      status.value = 'idle'
      return
    }
    status.value = 'playing'
    markNarrationPreloadStarted()
    preloadUpcoming()
  }
  catch (err) {
    if (currentPlayToken !== playToken)
      return

    releaseAudio()
    status.value = 'error'
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function toggle(event?: MouseEvent) {
  if (event?.currentTarget instanceof HTMLElement)
    event.currentTarget.blur()

  if (status.value === 'playing') {
    playToken += 1
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

watch(narrationRequest, (request) => {
  unregisterNarration()
  unregisterNarration = registerNarration(slideNo.value, request)
  preloadUpcoming()
}, { immediate: true })

watch(slideNo, () => {
  unregisterNarration()
  unregisterNarration = registerNarration(slideNo.value, narrationRequest.value)
  preloadUpcoming()
})

watch(activeSlideNo, () => {
  if (!isCurrentSlide.value) {
    playToken += 1
    releaseAudio()
    status.value = 'idle'
    error.value = ''
    return
  }

  preloadUpcoming()
})

onBeforeUnmount(() => {
  playToken += 1
  unregisterNarration()
  releaseAudio()
})
</script>

<template>
  <Teleport to="body">
    <button
      v-if="isCurrentSlide"
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
  </Teleport>
</template>

<style scoped>
.slidev-kokoro-narration {
  position: fixed;
  right: 2rem;
  bottom: 4.25rem;
  z-index: 1000;
  pointer-events: auto;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 7.5rem;
  max-width: calc(100vw - 4rem);
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
