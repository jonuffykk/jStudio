import type { AgentStep, ChatMessage, ChatUsage } from '@/app/lib/schemas'

export type Bubble = ChatMessage & { streaming?: boolean }
export type ActionState = 'pending' | 'applying' | 'applied' | 'failed'

export const noSpend: ChatUsage = { input: 0, output: 0, calls: 0, lastInput: 0 }

export const DAY = 86_400_000

export function bubble(role: 'user' | 'assistant', content: string, images: string[] = []): Bubble {
  return {
    role,
    content,
    actions: [],
    reasoning: '',
    steps: [],
    images,
    at: Date.now(),
    variants: [],
    variant: 0,
    artifacts: [],
    questions: [],
    resolved: false,
    folded: false,
    thinkMs: 0,
    replyMs: 0,
    plan: null,
    memories: [],
  }
}

export function appendSegment(steps: AgentStep[], kind: 'thought' | 'text', text: string): AgentStep[] {
  const last = steps[steps.length - 1]
  if (last?.kind === kind) return [...steps.slice(0, -1), { ...last, text: last.text + text }]
  return [...steps, { kind, id: '', status: 'done', name: '', target: '', source: '', text }]
}

export function compact(value: number): string {
  const trim = (scaled: number) => String(Math.round(scaled * 10) / 10)

  if (value >= 999_950) return `${trim(value / 1_000_000)}M`
  if (value >= 1000) return `${trim(value / 1000)}k`
  return String(value)
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

const steps: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60_000],
  ['minute', 3_600_000],
  ['hour', DAY],
  ['day', DAY * 7],
]

export function ago(value: number, language: string): string {
  if (!value) return ''

  const distance = value - Date.now()
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  let previous = 1000

  for (const [unit, limit] of steps) {
    if (Math.abs(distance) < limit) return format.format(Math.round(distance / previous), unit)
    previous = limit
  }

  return new Date(value).toLocaleDateString(language)
}

/** Paths the person attached with @Path.To.Script, so only those sources go in the prompt. */
export function attachmentsIn(text: string): string[] {
  return [...text.matchAll(/(?:^|\s)@([A-Za-z_][\w]*(?:\.[A-Za-z_][\w ]*)+)/g)]
    .map((match) => (match[1] ?? '').trim())
    .filter(Boolean)
}
