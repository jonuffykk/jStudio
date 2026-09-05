'use client'

import { useMemo, useState } from 'react'
import { condense, diffLines, diffStat } from '@/app/lib/diff'
import type { Action, UiNode } from '@/app/lib/schemas'
import { useStore } from '@/app/lib/state'
import { Badge, Button, Icon, IconButton, Spinner, cx } from '@/app/ui/primitives'
import type { ActionState } from '@/app/views/chat/types'

/** The screen as an outline, so a whole interface reads at a glance. */
function Tree({ node, depth = 0 }: { node: UiNode; depth?: number }) {
  const label = node.name ?? node.text ?? node.class

  return (
    <>
      <div className="flex items-baseline gap-2 px-4 py-0.5" style={{ paddingLeft: 16 + depth * 14 }}>
        <span className="truncate text-[12.5px] text-dim">{label}</span>
        <span className="shrink-0 font-mono text-[11px] text-faint">{node.class}</span>
        {node.style ? <span className="shrink-0 text-[11px] text-accent">{node.style}</span> : null}
      </div>

      {(node.children ?? []).map((child, index) => (
        <Tree key={index} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

function Diff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => condense(diffLines(before, after)), [before, after])

  return (
    <pre
      data-selectable
      className="max-h-96 overflow-auto border-t border-line bg-bg font-mono text-[12.5px] leading-relaxed"
    >
      {lines.map((line, index) => (
        <div
          key={index}
          className={cx(
            'px-4',
            line.kind === 'add' && 'bg-ok/10 text-ok',
            line.kind === 'remove' && 'bg-danger/10 text-danger'
          )}
        >
          <span className="select-none text-faint">
            {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}{' '}
          </span>
          {line.text}
        </div>
      ))}
    </pre>
  )
}

export function ProposalCard({
  action,
  state,
  canApply,
  onApply,
  onRevert,
}: {
  action: Action
  state: ActionState
  canApply: boolean
  onApply: () => void
  onRevert: () => void
}) {
  const { nodes, t } = useStore()
  const [open, setOpen] = useState(false)

  const isScript = action.kind === 'script'
  const isUi = action.kind === 'ui'
  const before = isScript ? (nodes.find((node) => node.path === action.path)?.source ?? '') : ''
  const stat = isScript ? diffStat(diffLines(before, action.source)) : null

  return (
    <article className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface transition-colors hover:border-focus">
      <header className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-raised text-accent">
          <Icon
            name={action.kind === 'delete' ? 'trash' : isScript ? 'build' : isUi ? 'grid' : 'spark'}
            className="size-4"
          />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[13px]">{action.path}</p>
          <p className="truncate text-xs text-dim">{action.summary}</p>
        </div>

        {stat && (stat.added > 0 || stat.removed > 0) ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            <span className="text-ok">+{stat.added}</span> <span className="text-danger">-{stat.removed}</span>
          </span>
        ) : null}

        <div className="flex shrink-0 items-center gap-1">
          {isScript || isUi ? (
            <IconButton
              icon="chevron"
              title={open ? t('build.hideCode') : t('build.viewCode')}
              onClick={() => setOpen(!open)}
            />
          ) : null}

          {state === 'applied' ? (
            <>
              <Badge tone="ok">{t('build.applied')}</Badge>
              <IconButton icon="refresh" title={t('build.revert')} onClick={onRevert} />
            </>
          ) : (
            <Button
              size="sm"
              tone={action.kind === 'delete' ? 'danger' : 'primary'}
              disabled={!canApply || state === 'applying'}
              onClick={onApply}
            >
              {state === 'applying' ? (
                <Spinner />
              ) : state === 'failed' ? (
                t('build.retry')
              ) : (
                t('build.apply')
              )}
            </Button>
          )}
        </div>
      </header>

      {isScript && open ? <Diff before={before} after={action.source} /> : null}

      {isUi && open ? (
        <div className="max-h-96 overflow-auto border-t border-line bg-bg py-2">
          <Tree node={action.tree} />
        </div>
      ) : null}
    </article>
  )
}
