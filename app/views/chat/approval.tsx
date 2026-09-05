'use client'

import type { ToolNote } from '@/app/lib/agent'
import { useStore } from '@/app/lib/state'
import { Button, Icon } from '@/app/ui/primitives'

export type ApprovalRequest = ToolNote & { resolve: (answer: 'once' | 'always' | 'deny') => void }

/** The approval gate: what is about to run, and the three answers to it. */
export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const { t } = useStore()

  return (
    <div className="riseIn overflow-hidden rounded-[var(--radius-panel)] border border-warn/40 bg-surface">
      <header className="flex items-center gap-2.5 px-3.5 py-2.5">
        <Icon name="alert" className="size-4 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">
            {t('build.approveTool', { tool: request.name })}
          </p>
          <p className="truncate text-xs text-faint">
            {request.source}
            {request.target ? ` · ${request.target}` : ''}
          </p>
        </div>
      </header>

      <footer className="flex items-center justify-end gap-2 border-t border-line px-3.5 py-2">
        <Button size="sm" tone="ghost" onClick={() => request.resolve('deny')}>
          {t('build.approveNo')}
        </Button>
        <Button size="sm" tone="ghost" onClick={() => request.resolve('always')}>
          {t('build.approveAlways')}
        </Button>
        <Button size="sm" tone="primary" onClick={() => request.resolve('once')}>
          {t('build.approveOnce')}
        </Button>
      </footer>
    </div>
  )
}
