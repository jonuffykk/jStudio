type Sound = 'send' | 'done' | 'error' | 'tap'

const voices: Record<Sound, { notes: number[]; duration: number; gain: number }> = {
  send: { notes: [523], duration: 0.055, gain: 0.03 },
  done: { notes: [659, 880], duration: 0.1, gain: 0.04 },
  error: { notes: [311, 233], duration: 0.14, gain: 0.045 },
  tap: { notes: [740], duration: 0.028, gain: 0.018 },
}

let context: AudioContext | null = null

function open(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    context = null
    return null
  }
}

export function unlockAudio(): void {
  open()
}

export function play(sound: Sound, enabled: boolean): void {
  if (!enabled) return
  const audio = open()
  if (!audio) return

  const voice = voices[sound]
  voice.notes.forEach((frequency, index) => {
    const start = audio.currentTime + index * voice.duration * 0.7
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(voice.gain, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + voice.duration)

    oscillator.connect(gain).connect(audio.destination)
    oscillator.start(start)
    oscillator.stop(start + voice.duration + 0.02)
  })
}
