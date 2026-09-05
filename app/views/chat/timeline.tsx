'use client'

import { useState } from 'react'
import { useStore } from '@/app/lib/state'
import type { AgentStep } from '@/app/lib/schemas'
import { Icon, Spinner, cx } from '@/app/ui/primitives'
import { Prose } from '@/app/views/chat/markdown'
import { formatDuration, type Bubble } from '@/app/views/chat/types'

type Block =
  | { kind: 'activity'; steps: AgentStep[] }
  | { kind: 'text'; text: string }
  | { kind: 'artifact'; step: AgentStep }
  | { kind: 'memory'; facts: string[] }

function Live() {
  const { t } = useStore()

  return (
    <p className="flex items-center gap-2 text-[13px]" role="status">
      <Spinner className="size-3.5" />
      <span className="liveText">{t('build.working')}</span>
    </p>
  )
}

function Step({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false)
  const hasOutput = step.text.trim().length > 0

  return (
    <li className="overflow-hidden rounded-[var(--radius-control)] bg-raised text-xs">
      <button
        type="button"
        disabled={!hasOutput}
        aria-expanded={hasOutput ? open : undefined}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors enabled:hover:bg-line/40"
      >
        {step.status === 'running' ? (
          <Spinner className="size-3" />
        ) : (
          <Icon
            name={step.status === 'failed' ? 'close' : 'check'}
            className={cx('size-3 shrink-0', step.status === 'failed' ? 'text-danger' : 'text-ok')}
          />
        )}
        <span className="shrink-0 font-mono text-dim">{step.name}</span>
        {step.target ? <span className="truncate text-faint">{step.target}</span> : null}
        {step.source ? <span className="ml-auto shrink-0 text-faint">{step.source}</span> : null}
        {hasOutput ? (
          <Icon name="chevron" className={cx('size-3 shrink-0 text-faint', open && 'rotate-90')} />
        ) : null}
      </button>

      {open && hasOutput ? (
        <pre
          data-selectable
          className="max-h-52 overflow-auto border-t border-line px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-faint"
        >
          {step.text}
        </pre>
      ) : null}
    </li>
  )
}

function ActivityBlock({
  steps,
  legacy,
  live,
  elapsed = 0,
}: {
  steps: AgentStep[]
  legacy: string
  live: boolean
  elapsed?: number
}) {
  const { t } = useStore()
  const [open, setOpen] = useState<boolean | null>(null)

  const tools = steps.filter((step) => step.kind === 'tool').length
  const running = steps.some((step) => step.status === 'running')
  const busy = live || running
  const expanded = open ?? busy

  return (
    <section className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-faint transition-colors hover:bg-raised hover:text-dim"
      >
        {busy ? <Spinner className="size-3.5" /> : <Icon name="spark" className="size-3.5 shrink-0" />}
        <span className={cx(busy && 'liveText')}>
          {running ? t('build.running') : busy ? t('build.thinking') : t('build.reasoning')}
        </span>
        {tools > 0 ? (
          <span className="text-xs">
            · {tools} {tools === 1 ? t('build.step') : t('build.steps')}
          </span>
        ) : null}
        {!busy && elapsed > 0 ? (
          <span className="font-mono text-xs tabular-nums">· {formatDuration(elapsed)}</span>
        ) : null}
        <Icon name="chevron" className={cx('ml-auto size-3.5 transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded ? (
        <div className="space-y-2.5 border-t border-line px-3 py-3">
          {legacy ? <Prose text={legacy} className="text-[13px] text-dim" /> : null}

          <ul className="space-y-1.5">
            {steps.map((step, index) =>
              step.kind === 'thought' ? (
                <li key={index}>
                  <Prose text={step.text} className="text-[13px] text-dim" />
                </li>
              ) : (
                <Step key={step.id || index} step={step} />
              )
            )}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function Artifact({ step, live }: { step: AgentStep; live: boolean }) {
  const { t } = useStore()
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? live

  return (
    <section className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-faint transition-colors hover:bg-raised hover:text-dim"
      >
        {live ? <Spinner className="size-3.5" /> : <Icon name="agent" className="size-3.5 text-accent" />}
        <span className="font-medium text-dim">{step.name}</span>
        <span className="truncate text-xs">{step.source}</span>
        <Icon name="chevron" className={cx('ml-auto size-3.5 transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded ? (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          {step.target ? <p className="text-xs text-faint">{step.target}</p> : null}
          {step.text ? (
            <Prose text={step.text} className="text-[13px] text-dim" />
          ) : (
            <p className="text-[13px] text-faint">{t('build.working')}</p>
          )}
        </div>
      ) : null}
    </section>
  )
}

function Saved({ facts }: { facts: string[] }) {
  const { t } = useStore()
  const [open, setOpen] = useState(false)

  const first = facts[0] ?? ''
  const more = facts.length - 1

  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface text-xs">
      <button
        type="button"
        aria-expanded={open}
        disabled={facts.length === 0}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors enabled:hover:bg-raised"
      >
        <Icon name="memory" className="size-3.5 shrink-0 text-accent" />
        <span className="shrink-0 text-dim">{t('build.saved')}</span>
        <span className="min-w-0 flex-1 truncate text-faint">{first}</span>
        {more > 0 ? <span className="shrink-0 text-faint">+{more}</span> : null}
        <Icon name="chevron" className={cx('size-3 shrink-0 text-faint', open && 'rotate-90')} />
      </button>

      {open ? (
        <ul data-selectable className="space-y-1 border-t border-line px-2.5 py-2 text-faint">
          {facts.map((fact, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-line">·</span>
              <span className="min-w-0 flex-1 break-words">{fact}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function Timeline({ message, allowed }: { message: Bubble; allowed: boolean }) {
  const steps = allowed ? message.steps : message.steps.filter((step) => step.kind !== 'thought')
  const legacy = allowed ? message.reasoning : ''

  const blocks: Block[] = []
  for (const step of steps) {
    const last = blocks[blocks.length - 1]

    if (step.kind === 'artifact') blocks.push({ kind: 'artifact', step })
    else if (step.kind === 'memory') {
      if (last?.kind === 'memory') last.facts.push(step.text)
      else blocks.push({ kind: 'memory', facts: [step.text] })
    } else if (step.kind === 'text') {
      if (last?.kind === 'text') last.text += step.text
      else blocks.push({ kind: 'text', text: step.text })
    } else if (last?.kind === 'activity') last.steps.push(step)
    else blocks.push({ kind: 'activity', steps: [step] })
  }

  const wrote = blocks.some((block) => block.kind === 'text')
  const firstActivity = blocks.findIndex((block) => block.kind === 'activity')

  if (blocks.length === 0 && !legacy && !message.content) {
    return message.streaming ? <Live /> : null
  }

  return (
    <>
      {legacy ? <ActivityBlock steps={[]} legacy={legacy} live={false} /> : null}

      {blocks.map((block, index) => {
        const live = !!message.streaming && index === blocks.length - 1

        if (block.kind === 'text') return <Prose key={index} text={block.text} />
        if (block.kind === 'memory') return <Saved key={index} facts={block.facts} />
        if (block.kind === 'artifact') return <Artifact key={index} step={block.step} live={live} />

        return (
          <ActivityBlock
            key={index}
            steps={block.steps}
            legacy=""
            live={live}
            elapsed={index === firstActivity ? message.replyMs || message.thinkMs : 0}
          />
        )
      })}

      {!wrote && message.content ? <Prose text={message.content} /> : null}
    </>
  )
}
