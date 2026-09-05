'use client'

import { memo, useState } from 'react'
import { useImage } from '@/app/lib/blobs'
import type { Action } from '@/app/lib/schemas'
import { useStore } from '@/app/lib/state'
import { Icon, IconButton, cx } from '@/app/ui/primitives'
import { useDateFormat } from '@/app/ui/usageChart'
import { Timeline } from '@/app/views/chat/timeline'
import { ProposalCard } from '@/app/views/chat/proposal'
import { ago, formatDuration, type ActionState, type Bubble } from '@/app/views/chat/types'

function Attachment({ value, size = 'md' }: { value: string; size?: 'sm' | 'md' }) {
  const src = useImage(value)
  if (!src) return null

  return (
    <img
      src={src}
      alt=""
      className={cx('rounded-[var(--radius-control)] object-cover', size === 'sm' ? 'size-12' : 'size-20')}
    />
  )
}

/** What was asked and what was decided, kept in the transcript after the card goes. */
function Decided({ message }: { message: Bubble }) {
  const { t } = useStore()

  if (message.plan) {
    return (
      <section className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface">
        <header className="flex items-center gap-2 px-3 py-2">
          <Icon name="plan" className="size-3.5 shrink-0 text-accent" />
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{message.plan.title}</p>
          {message.resolved ? (
            <span className="shrink-0 text-[11px] text-ok">{t('build.approved')}</span>
          ) : null}
        </header>

        <ol data-selectable className="divide-y divide-line border-t border-line">
          {message.plan.steps.map((step, index) => (
            <li key={index} className="flex items-start gap-3 px-3 py-1.5 text-[13px]">
              <span className="w-4 shrink-0 text-right text-[11px] text-faint">{index + 1}</span>
              <span className="min-w-0 flex-1 text-dim">{step}</span>
            </li>
          ))}
        </ol>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface">
      <ul data-selectable className="divide-y divide-line">
        {message.questions.map((question, index) => (
          <li key={index} className="flex items-start gap-2 px-3 py-2 text-[13px]">
            <Icon name="question" className="mt-0.5 size-3.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">{question.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Stamp({ at }: { at: number }) {
  const language = useStore((state) => state.settings.language)
  const full = useDateFormat()
  if (!at) return null

  return (
    <span className="ml-1 text-[11px] text-faint" title={full(at)}>
      {ago(at, language)}
    </span>
  )
}

function MessageBody({
  message,
  index,
  last,
  states,
  canApply,
  showReasoning,
  onApply,
  onRevert,
  onEdit,
  onRegenerate,
  onFork,
}: {
  message: Bubble
  index: number
  last: boolean
  states: Record<string, ActionState>
  canApply: boolean
  showReasoning: boolean
  onApply: (index: number, action: Action, position: number) => void
  onRevert: (index: number, position: number) => void
  onEdit: (index: number, text: string, images: string[]) => void
  onRegenerate: () => void
  onFork: (index: number) => void
}) {
  const { t } = useStore()
  const [draft, setDraft] = useState<string | null>(null)
  const [kept, setKept] = useState<string[]>(message.images)
  const [copied, setCopied] = useState(false)
  const editing = draft !== null

  const start = () => {
    setKept(message.images)
    setDraft(message.content)
  }

  const save = () => {
    const text = (draft ?? '').trim()
    const changed = text !== message.content || kept.length !== message.images.length
    setDraft(null)
    if ((text || kept.length > 0) && changed) onEdit(index, text, kept)
  }

  const copy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end gap-2">
        {!editing && message.images.length > 0 ? (
          <div className="flex gap-2">
            {message.images.map((image, position) => (
              <Attachment key={position} value={image} />
            ))}
          </div>
        ) : null}

        {editing ? (
          <div className="w-full overflow-hidden rounded-[var(--radius-panel)] border border-focus bg-bg">
            {kept.length > 0 ? (
              <div className="flex flex-wrap gap-2 border-b border-line p-2">
                {kept.map((image, position) => (
                  <span key={position} className="relative">
                    <Attachment value={image} size="sm" />
                    <button
                      type="button"
                      title={t('common.delete')}
                      onClick={() => setKept(kept.filter((_, at) => at !== position))}
                      className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-line bg-surface text-dim transition-colors hover:text-danger"
                    >
                      <Icon name="close" className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <textarea
              autoFocus
              value={draft ?? ''}
              rows={3}
              aria-label={t('build.edit')}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setDraft(null)
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  save()
                }
              }}
              className="max-h-56 w-full resize-none bg-transparent px-4 py-3 text-sm outline-none"
            />

            <div className="flex items-center gap-2 border-t border-line px-2 py-1.5">
              <span className="ml-1 text-[11px] text-faint">{t('build.editHint')}</span>
              <span className="ml-auto flex items-center gap-1">
                <IconButton size="sm" icon="close" title={t('common.cancel')} onClick={() => setDraft(null)} />
                <IconButton size="sm" icon="check" title={t('build.send')} onClick={save} />
              </span>
            </div>
          </div>
        ) : message.content ? (
          <p
            data-selectable
            className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-panel)] bg-accent px-4 py-2.5 text-sm text-white"
          >
            {message.content}
          </p>
        ) : null}

        <div
          className={cx(
            'flex items-center gap-0.5 transition-opacity focus-within:opacity-100 group-hover:opacity-100',
            editing ? 'hidden' : 'opacity-0'
          )}
        >
          <IconButton
            size="sm"
            icon="edit"
            title={t('build.edit')}
            onClick={start}
          />
          <IconButton
            size="sm"
            icon="copy"
            title={copied ? t('build.copied') : t('build.copy')}
            onClick={() => void copy()}
          />
          <IconButton size="sm" icon="fork" title={t('build.fork')} onClick={() => onFork(index)} />
          <Stamp at={message.at} />
        </div>
      </div>
    )
  }

  return (
    <div className="group space-y-3">
      <Timeline message={message} allowed={showReasoning} />

      {message.plan || message.questions.length > 0 ? <Decided message={message} /> : null}

      {message.actions.map((action, position) => (
        <ProposalCard
          key={`${action.path}:${position}`}
          action={action}
          state={states[`${index}:${position}`] ?? 'pending'}
          canApply={canApply}
          onApply={() => onApply(index, action, position)}
          onRevert={() => onRevert(index, position)}
        />
      ))}

      {message.streaming ? null : (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            size="sm"
            icon="copy"
            title={copied ? t('build.copied') : t('build.copy')}
            onClick={() => void copy()}
          />
          {last ? (
            <IconButton size="sm" icon="refresh" title={t('build.regenerate')} onClick={onRegenerate} />
          ) : null}
          <IconButton size="sm" icon="fork" title={t('build.fork')} onClick={() => onFork(index)} />
          {message.replyMs > 0 ? (
            <span className="ml-1 font-mono text-xs tabular-nums text-faint" title={t('build.elapsed')}>
              {formatDuration(message.replyMs)}
            </span>
          ) : null}
          <Stamp at={message.at} />
        </div>
      )}
    </div>
  )
}

/**
 * Only the message that changed re-renders, so a long transcript stays cheap
 * while tokens stream into the last bubble.
 */
export const Message = memo(MessageBody)
