const SILENT_WAV_URL = 'data:audio/wav;base64,UklGRjYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YRIAAAAAAAAAAAAAAAAAAAAAAAAA'

export function createUnlockedAudioElement() {
  const audio = new Audio(SILENT_WAV_URL)
  audio.preload = 'auto'
  audio.playsInline = true
  const unlockSrc = audio.src

  void audio.play()
    .then(() => {
      if (audio.src === unlockSrc) {
        audio.pause()
        audio.currentTime = 0
      }
    })
    .catch(() => {})

  return audio
}
