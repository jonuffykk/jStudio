'use client'

import type { UsageDay } from '@/app/lib/schemas'
import { compactTokens, lastDays } from '@/app/lib/usage'
import { useStore } from '@/app/lib/state'
import { cx } from '@/app/ui/primitives'

/** Dates in the language the app is running in. */
export function useDayFormat(): (day: string) => string {
  const language = useStore((state) => state.settings.language)
  const format = new Intl.DateTimeFormat(language, { day: '2-digit', month: 'short' })

  return (day: string) => {
    const parsed = new Date(`${day}T12:00:00`)
    return Number.isNaN(parsed.getTime()) ? day : format.format(parsed)
  }
}

export function useDateFormat(): (at: number) => string {
  const language = useStore((state) => state.settings.language)
  const format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' })
  return (at: number) => (at ? format.format(new Date(at)) : '')
}

/**
 * One bar per day, one series: the total. Input and output never share a scale
 * because one is always an order of magnitude above the other — their split is
 * spelled out in words under the chart instead.
 */
export function UsageBars({
  days,
  span = 14,
  height = 'h-24',
}: {
  days: UsageDay[]
  span?: number
  height?: string
}) {
  const { t } = useStore()
  const dayLabel = useDayFormat()

  const slots = lastDays(days, span)
  const peak = Math.max(1, ...slots.map((slot) => slot.total))

  return (
    <div>
      <div className={cx('flex items-end gap-[3px]', height)}>
        {slots.map((slot) => (
          <span
            key={slot.day}
            title={`${dayLabel(slot.day)} · ${slot.total.toLocaleString()}`}
            className="flex h-full flex-1 items-end"
          >
            <span
              className={cx(
                'w-full rounded-[2px] transition-colors',
                slot.total > 0 ? 'bg-accent hover:bg-accent-hover' : 'bg-line'
              )}
              style={{ height: slot.total > 0 ? `${Math.max((slot.total / peak) * 100, 6)}%` : '2px' }}
            />
          </span>
        ))}
      </div>

      <p className="mt-1.5 flex justify-between text-[10px] tabular-nums text-faint">
        <span>{dayLabel(slots[0]?.day ?? '')}</span>
        <span>{t('usage.today')}</span>
      </p>
    </div>
  )
}

/** Where the tokens went, in a line: input, output, and what output is worth. */
export function UsageSplit({ input, output }: { input: number; output: number }) {
  const { t } = useStore()
  const total = input + output
  const share = total > 0 ? (output / total) * 100 : 0

  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-raised">
        <span className="bg-accent/35" style={{ width: `${100 - share}%` }} />
        <span className="bg-accent" style={{ width: `${share}%` }} />
      </div>

      <p className="flex items-center gap-3 text-[11px] tabular-nums text-faint">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-accent/35" />
          {t('settings.usageIn')} {compactTokens(input)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-accent" />
          {t('settings.usageOut')} {compactTokens(output)}
        </span>
        <span className="ml-auto">{share >= 0.1 ? `${share.toFixed(1)}%` : '—'}</span>
      </p>
    </div>
  )
}
