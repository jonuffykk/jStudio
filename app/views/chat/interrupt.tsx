'use client'

import { useState } from 'react'
import { useStore } from '@/app/lib/state'
import { Button, Icon, IconButton } from '@/app/ui/primitives'
import type { Bubble } from '@/app/views/chat/types'

export function Interrupt({
  message,
  onAnswer,
  onApprove,
  onDismiss,
}: {
  message: Bubble
  onAnswer: (text: string) => void
  onApprove: () => void
  onDismiss: () => void
}) {
  const { t } = useStore()
  const [at, setAt] = useState(0)
  const [answers, setAnswers] = useState<string[]>(() => message.questions.map(() => ''))

  const questions = message.questions
  const question = questions[at]

  const pick = (option: string) => {
    const next = answers.map((entry, index) => (index === at ? option : entry))
    setAnswers(next)

    if (at < questions.length - 1) {
      setAt(at + 1)
      return
    }

    onAnswer(
      questions.map((entry, index) => `${entry.text}\n${next[index]?.trim() || '—'}`).join('\n\n')
    )
  }

  return (
    <div className="riseIn overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <header className="flex items-center gap-3 px-3.5 py-2.5">
        <p className="min-w-0 flex-1 text-[13px] font-medium">
          {message.plan ? message.plan.title : (question?.text ?? '')}
        </p>

        {questions.length > 1 ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint">
            <IconButton
              size="sm"
              tone="plain"
              icon="back"
              title={t('build.previous')}
              disabled={at === 0}
              onClick={() => setAt(at - 1)}
            />
            {at + 1}/{questions.length}
            <IconButton
              size="sm"
              tone="plain"
              icon="chevron"
              title={t('build.next')}
              disabled={at === questions.length - 1}
              onClick={() => setAt(at + 1)}
            />
          </span>
        ) : null}

        <IconButton size="sm" tone="plain" icon="close" title={t('build.skip')} onClick={onDismiss} />
      </header>

      {message.plan ? (
        <>
          <ol data-selectable className="divide-y divide-line border-t border-line">
            {message.plan.steps.map((step, index) => (
              <li key={index} className="flex items-start gap-3 px-3.5 py-2 text-[13px]">
                <span className="w-4 shrink-0 text-right text-[11px] text-faint">{index + 1}</span>
                <span className="min-w-0 flex-1 text-dim">{step}</span>
              </li>
            ))}
          </ol>

          <footer className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2">
            <span className="text-xs text-faint">{t('build.approveHint')}</span>
            <Button size="sm" tone="primary" onClick={onApprove}>
              {t('build.approvePlan')}
            </Button>
          </footer>
        </>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {(question?.options ?? []).map((option, index) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => pick(option)}
                className="group flex w-full items-center gap-3 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-raised"
              >
                <span className="w-4 shrink-0 text-right text-[11px] text-faint">{index + 1}</span>
                <span className="min-w-0 flex-1">{option}</span>
                <Icon
                  name="chevron"
                  className="size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
                />
              </button>
            </li>
          ))}

          <li className="flex items-center gap-3 px-3.5 py-2 text-[13px] text-faint">
            <Icon name="edit" className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{t('build.answerHint')}</span>
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-xs transition-colors hover:bg-raised hover:text-text"
            >
              {t('build.skip')}
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}
