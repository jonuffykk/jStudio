'use client'

import { useState } from 'react'
import type { MessageKey } from '@/app/lib/i18n'
import type { ChatUsage } from '@/app/lib/schemas'
import { useStore } from '@/app/lib/state'
import { Popover, Ring, cx } from '@/app/ui/primitives'
import { compact } from '@/app/views/chat/types'

export type Slice = { key: MessageKey; chars: number; className: string }

export function UsagePill({ usage, slices }: { usage: ChatUsage; slices: Slice[] }) {
  const { settings, t } = useStore()
  const [open, setOpen] = useState(false)

  if (usage.calls === 0) return null

  const limit = settings.contextLimit
  const carried = Math.min(usage.lastInput, limit)
  const share = Math.round((carried / limit) * 100)

  /**
   * The prompt is built in this app, so its composition is exact in characters.
   * Each share is scaled to the token count the provider actually charged for,
   * and every percentage below is a share of that same prompt.
   */
  const chars = slices.reduce((sum, slice) => sum + slice.chars, 0)
  const parts = slices
    .filter((slice) => slice.chars > 0)
    .map((slice) => ({
      ...slice,
      tokens: chars > 0 ? Math.round((slice.chars / chars) * carried) : 0,
      share: chars > 0 ? (slice.chars / chars) * 100 : 0,
    }))
    .sort((left, right) => right.share - left.share)

  const rows: { label: string; value: string }[] = [
    { label: t('build.spentIn'), value: usage.input.toLocaleString() },
    { label: t('build.spentOut'), value: usage.output.toLocaleString() },
    { label: t('build.spentTotal'), value: (usage.input + usage.output).toLocaleString() },
    { label: t('build.spentCalls'), value: String(usage.calls) },
  ]

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        title={`${t('build.context')} ${compact(carried)} · ${share}%`}
        onClick={() => setOpen(!open)}
        className="flex items-center rounded-[var(--radius-control)] px-1.5 py-1 transition-colors hover:bg-raised"
      >
        <Ring value={carried} total={limit} label={compact(carried)} />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} align="right">
        <div className="w-72 space-y-2.5 px-3 py-2.5">
          <p className="flex items-baseline justify-between gap-4">
            <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
              {t('build.context')}
            </span>
            <span className="font-mono text-xs tabular-nums text-dim">
              {compact(carried)} / {compact(limit)} ({share}%)
            </span>
          </p>

          <div className="flex h-2 overflow-hidden rounded-full bg-raised">
            {parts.map((part) => (
              <span
                key={part.key}
                title={t(part.key)}
                className={part.className}
                style={{ width: `${(part.tokens / limit) * 100}%` }}
              />
            ))}
          </div>

          {parts.length > 0 ? (
            <div className="space-y-1 border-t border-line pt-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
                {t('build.compose')}
              </p>

              <ul className="space-y-1">
                {parts.map((part) => (
                  <li key={part.key} className="flex items-center gap-2 text-xs">
                    <span className={cx('size-2 shrink-0 rounded-sm', part.className)} />
                    <span className="min-w-0 flex-1 truncate text-dim">{t(part.key)}</span>
                    <span className="shrink-0 font-mono tabular-nums text-faint">
                      {compact(part.tokens)}
                    </span>
                    <span className="w-10 shrink-0 text-right font-mono tabular-nums text-faint">
                      {part.share >= 1 ? Math.round(part.share) : '<1'}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-1 border-t border-line pt-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
              {t('build.spent')}
            </p>
            {rows.map((row) => (
              <p key={row.label} className="flex justify-between gap-6 text-xs">
                <span className="text-dim">{row.label}</span>
                <span className="font-mono tabular-nums text-faint">{row.value}</span>
              </p>
            ))}
          </div>

          {share >= 70 ? (
            <p className="text-xs text-warn">
              <span className="font-mono">/compress</span> · {t('build.compressHint')}
            </p>
          ) : null}
        </div>
      </Popover>
    </div>
  )
}
