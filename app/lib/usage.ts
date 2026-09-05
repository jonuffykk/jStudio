import { usageDay, usagePulse, type UsageDay, type UsagePulse, type UsageSource } from './schemas.ts'

export type { UsageSource }

const api = async () => (await import('@/app/lib/ipc')).usage

/** The calendar day where the person is, not where UTC is. */
export function dayKey(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** The keys of the last `span` calendar days, today last. */
export function daySpan(span: number, now = Date.now()): string[] {
  return Array.from({ length: span }, (_, index) => dayKey(now - (span - 1 - index) * 86_400_000))
}

/** The last `span` days, present or not, so a chart reads the same on day one. */

export type UsageStore = { days: UsageDay[]; pulse: UsagePulse[] }

const MAX_DAYS = 120
const MAX_PULSE = 500
const PULSE_WINDOW = 172_800_000

export const emptyUsage: UsageStore = { days: [], pulse: [] }

function parse(value: { days: unknown[]; pulse: unknown[] }): UsageStore {
  return {
    days: value.days.flatMap((entry) => {
      const parsed = usageDay.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
    pulse: value.pulse.flatMap((entry) => {
      const parsed = usagePulse.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
  }
}

export async function loadUsage(): Promise<UsageStore> {
  try {
    return parse(await (await api()).load())
  } catch {
    return emptyUsage
  }
}

/** Folds one exchange into the ledger. Pure, so the caller decides when to persist. */
export function recordUsage(
  store: UsageStore,
  entry: { input: number; output: number; model: string; source: UsageSource; cost: number | null },
  now = Date.now()
): UsageStore {
  const day = dayKey(now)
  const days = [...store.days]
  const index = days.findIndex((item) => item.day === day)
  const current = days[index]

  const merged: UsageDay = {
    day,
    input: (current?.input ?? 0) + entry.input,
    output: (current?.output ?? 0) + entry.output,
    runs: (current?.runs ?? 0) + 1,
    cost: (current?.cost ?? 0) + (entry.cost ?? 0),
    bySource: {
      ...current?.bySource,
      [entry.source]: (current?.bySource?.[entry.source] ?? 0) + entry.input + entry.output,
    },
  }

  if (index === -1) days.unshift(merged)
  else days[index] = merged

  const pulse = [...store.pulse, { at: now, input: entry.input, output: entry.output }]
    .filter((item) => item.at >= now - PULSE_WINDOW)
    .slice(-MAX_PULSE)

  return { days: days.slice(0, MAX_DAYS), pulse }
}

let queued: UsageStore | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** Usage is written on its own file and at most once a second, never with the settings. */
export function saveUsage(store: UsageStore): void {
  queued = store
  if (timer) return

  timer = setTimeout(() => {
    timer = null
    const pending = queued
    queued = null
    if (pending) void api().then((usage) => usage.save(pending)).catch(() => {})
  }, 1000)
}

export function flushUsage(): void {
  if (!queued) return
  const pending = queued
  queued = null
  if (timer) clearTimeout(timer)
  timer = null
  void api().then((usage) => usage.save(pending)).catch(() => {})
}

export const compactTokens = (value: number) =>
  value >= 1_000_000
    ? `${Math.round(value / 100_000) / 10}M`
    : value >= 1000
      ? `${Math.round(value / 100) / 10}k`
      : String(value)

export function lastDays(days: UsageDay[], span: number, now = Date.now()): { day: string; total: number }[] {
  const known = new Map(days.map((entry) => [entry.day, entry.input + entry.output]))
  return daySpan(span, now).map((day) => ({ day, total: known.get(day) ?? 0 }))
}

export type UsageTotals = { input: number; output: number; runs: number; cost: number; days: number }

const empty: UsageTotals = { input: 0, output: 0, runs: 0, cost: 0, days: 0 }

/** Adds up whole calendar days, so "today" is today and not the last 24 hours. */
export function totalsOver(days: UsageDay[], span: number, now = Date.now()): UsageTotals {
  const window = new Set(daySpan(span, now))

  return days
    .filter((entry) => window.has(entry.day))
    .reduce(
      (sum, entry) => ({
        input: sum.input + entry.input,
        output: sum.output + entry.output,
        runs: sum.runs + entry.runs,
        cost: sum.cost + entry.cost,
        days: sum.days + 1,
      }),
      empty
    )
}
