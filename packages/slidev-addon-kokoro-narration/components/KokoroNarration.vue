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
  stopNarrationPreload,
} from '../utils/narration'
import { createUnlockedAudioElement, startAudioPlayback } from '../utils/playback'
import { generateKokoroNarration, loadKokoroTts, terminateKokoroWorker } from '../utils/tts'

function releaseFocus() {
  if (document.activeElement instanceof HTMLElement)
    document.activeElement.blur()
}

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
  dtype: 'q4',
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
const activeSlideNo = computed(() => unref($nav.value.currentSlideNo))
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
    return progress.value > 0 ? `Cancel ${Math.round(progress.value)}%` : 'Cancel'
  if (status.value === 'generating')
    return 'Cancel'
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
    totalSlides: unref($nav.value.total),
    preload: props.preload,
    cacheSize: props.cacheSize,
    generate: request => generateKokoroNarration(request),
  })
}

function prewarmModel() {
  if (isCurrentSlide.value) {
    void loadKokoroTts(narrationRequest.value).catch((err) => {
      console.warn('Failed to pre-warm Kokoro TTS:', err)
    })
  }
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
      stopNarrationPreload()
    }
    audio.onerror = () => {
      releaseAudio()
      status.value = 'error'
      error.value = 'Playback failed'
    }
    await startAudioPlayback(audio, () => {
      if (currentPlayToken === playToken && isCurrentSlide.value)
        status.value = 'playing'
    })
    if (currentPlayToken !== playToken || !isCurrentSlide.value) {
      releaseAudio()
      status.value = 'idle'
      return
    }
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

function toggle(event?: MouseEvent | KeyboardEvent) {
  releaseFocus()

  if (isBusy.value || status.value === 'playing') {
    playToken += 1
    releaseAudio()
    status.value = 'idle'
    stopNarrationPreload()
    terminateKokoroWorker()
    return
  }
  void play()
}

function onControlKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ')
    return
  event.preventDefault()
  toggle(event)
}

onMounted(() => {
  if (props.autoplay)
    void play()
})

watch(narrationRequest, (request) => {
  unregisterNarration()
  unregisterNarration = registerNarration(slideNo.value, request)
  preloadUpcoming()
  prewarmModel()
}, { immediate: true })

watch(slideNo, () => {
  unregisterNarration()
  unregisterNarration = registerNarration(slideNo.value, narrationRequest.value)
  preloadUpcoming()
  prewarmModel()
})

watch(isCurrentSlide, (current) => {
  if (!current) {
    playToken += 1
    releaseAudio()
    status.value = 'idle'
    error.value = ''
    stopNarrationPreload()
    return
  }

  preloadUpcoming()
  prewarmModel()
}, { immediate: true })

onBeforeUnmount(() => {
  playToken += 1
  unregisterNarration()
  releaseAudio()
  stopNarrationPreload()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isCurrentSlide"
      class="slidev-kokoro-narration"
      role="button"
      tabindex="-1"
      :aria-disabled="!narrationText"
      :aria-busy="isBusy"
      :aria-label="buttonLabel"
      :title="error || buttonLabel"
      @click="toggle"
      @keydown="onControlKeydown"
    >
      <span class="slidev-kokoro-narration__mark" :data-status="status" />
      <span>{{ buttonLabel }}</span>
    </div>
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
  border: 1px solid rgb(148 163 184 / 30%);
  border-radius: 999px;
  color: rgb(15 23 42);
  background: rgb(255 255 255 / 85%);
  box-shadow: 0 10px 28px rgb(15 23 42 / 12%), 0 4px 10px rgb(15 23 42 / 4%);
  font:
    600 0.82rem/1 system-ui,
    sans-serif;
  cursor: pointer;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  transform: translateY(0);
}

.slidev-kokoro-narration:hover:not([aria-disabled='true']) {
  transform: translateY(-2px);
  background: rgb(255 255 255 / 95%);
  border-color: rgb(148 163 184 / 50%);
  box-shadow: 0 12px 32px rgb(15 23 42 / 16%), 0 6px 12px rgb(15 23 42 / 6%);
}

.slidev-kokoro-narration:active:not([aria-disabled='true']) {
  transform: translateY(1px);
  background: rgb(255 255 255 / 80%);
  box-shadow: 0 6px 16px rgb(15 23 42 / 10%);
}

.slidev-kokoro-narration[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.6;
  pointer-events: none;
}

html.dark .slidev-kokoro-narration {
  color: rgb(241 245 249);
  background: rgb(15 23 42 / 75%);
  border: 1px solid rgb(255 255 255 / 12%);
  box-shadow: 0 10px 28px rgb(0 0 0 / 30%), 0 4px 10px rgb(0 0 0 / 15%);
}

html.dark .slidev-kokoro-narration:hover:not([aria-disabled='true']) {
  background: rgb(15 23 42 / 85%);
  border-color: rgb(255 255 255 / 20%);
  box-shadow: 0 12px 32px rgb(0 0 0 / 40%), 0 6px 12px rgb(0 0 0 / 20%);
}

html.dark .slidev-kokoro-narration:active:not([aria-disabled='true']) {
  background: rgb(15 23 42 / 65%);
  box-shadow: 0 6px 16px rgb(0 0 0 / 25%);
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
