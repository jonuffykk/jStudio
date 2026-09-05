'use client'

import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '@/app/lib/state'
import { Icon, cx } from '@/app/ui/primitives'

export const markdownClass =
  'max-w-none text-sm leading-relaxed [&_a]:text-accent [&_code]:rounded [&_code]:bg-raised [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-[var(--radius-control)] [&_pre]:bg-raised [&_pre]:p-3 [&_pre_code]:bg-transparent [&_strong]:font-semibold [&_table]:my-2 [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5'

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  const element = node as { props?: { children?: ReactNode } }
  return element.props ? textOf(element.props.children) : ''
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const { t } = useStore()
  const [copied, setCopied] = useState(false)
  const code = textOf(children).replace(/\n$/, '')

  return (
    <div className="group/code relative">
      <pre>{children}</pre>
      <button
        type="button"
        title={copied ? t('build.copied') : t('build.copy')}
        onClick={() => {
          void navigator.clipboard.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        }}
        className={cx(
          'absolute right-2 top-2 flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-xs transition-opacity',
          copied ? 'text-ok opacity-100' : 'text-dim opacity-0 group-hover/code:opacity-100 hover:text-text'
        )}
      >
        <Icon name={copied ? 'check' : 'copy'} className="size-3.5" />
        {copied ? t('build.copied') : t('build.copy')}
      </button>
    </div>
  )
}

const components = { pre: CodeBlock }

export function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div data-selectable className={cx(markdownClass, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
