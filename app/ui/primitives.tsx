'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  Blocks,
  Bot,
  BookOpen,
  Brain,
  ChartColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  CircleHelp,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  Film,
  GitBranch,
  Globe,
  House,
  Image,
  KeyRound,
  LayoutGrid,
  Link,
  ListChecks,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Puzzle,
  Redo2,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  Undo2,
  User,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

const icons: Record<string, LucideIcon> = {
  agent: Bot,
  alert: TriangleAlert,
  archive: Archive,
  book: BookOpen,
  build: Wrench,
  chart: ChartColumn,
  check: Check,
  back: ChevronLeft,
  chevron: ChevronRight,
  clock: Clock,
  close: X,
  copy: Copy,
  download: Download,
  edit: Pencil,
  external: ExternalLink,
  film: Film,
  fork: GitBranch,
  globe: Globe,
  grid: LayoutGrid,
  home: House,
  image: Image,
  key: KeyRound,
  link: Link,
  memory: Brain,
  menu: MoreHorizontal,
  minus: Minus,
  pause: Pause,
  pin: Pin,
  plan: ListChecks,
  play: Play,
  plugin: Blocks,
  plus: Plus,
  puzzle: Puzzle,
  question: CircleHelp,
  redo: Redo2,
  refresh: RefreshCw,
  script: FileCode,
  search: Search,
  settings: Settings,
  sidebar: PanelLeft,
  sliders: SlidersHorizontal,
  spark: Sparkles,
  square: Square,
  stop: CircleStop,
  trash: Trash2,
  undo: Undo2,
  unpin: PinOff,
  user: User,
}

export function Icon({ name, className }: { name: string; className?: string }) {
  const Glyph = icons[name] ?? Sparkles
  return <Glyph aria-hidden strokeWidth={1.75} className={cx('size-[18px] shrink-0', className)} />
}

type ButtonProps = {
  children: ReactNode
  onClick?: () => void
  tone?: 'primary' | 'neutral' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  icon?: string
  full?: boolean
  title?: string
}

export function Button({
  children,
  onClick,
  tone = 'neutral',
  size = 'md',
  disabled,
  icon,
  full,
  title,
}: ButtonProps) {
  const tones = {
    primary: 'bg-accent text-white hover:bg-accent-hover border-transparent',
    neutral: 'bg-raised text-text hover:border-focus border-line',
    ghost: 'bg-transparent text-dim hover:text-text hover:bg-raised border-transparent',
    danger: 'bg-transparent text-danger hover:bg-danger/10 border-transparent',
  }

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        full && 'w-full',
        tones[tone]
      )}
    >
      {icon ? <Icon name={icon} className={size === 'sm' ? 'size-4' : 'size-[18px]'} /> : null}
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  onClick,
  title,
  tone = 'ghost',
  size = 'md',
  disabled,
}: {
  icon: string
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  title: string
  tone?: 'ghost' | 'danger' | 'plain'
  size?: 'sm' | 'md'
  disabled?: boolean
}) {
  const tones = {
    ghost: 'text-dim hover:bg-raised hover:text-text',
    danger: 'text-dim hover:bg-danger/10 hover:text-danger',
    plain: 'text-faint hover:text-text',
  }

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center justify-center rounded-[var(--radius-control)] transition-colors disabled:pointer-events-none disabled:opacity-30',
        size === 'sm' ? 'size-7' : 'size-8',
        tones[tone]
      )}
    >
      <Icon name={icon} className={size === 'sm' ? 'size-3.5' : 'size-4'} />
    </button>
  )
}

export function Panel({
  title,
  description,
  action,
  children,
}: {
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex h-full flex-col rounded-[var(--radius-panel)] border border-line bg-surface">
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] text-dim">{description}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className="flex-1 p-5">{children}</div>
    </section>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-dim">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-faint">{hint}</span> : null}
    </label>
  )
}

const controlClass =
  'w-full rounded-[var(--radius-control)] border border-line bg-bg px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-faint focus:border-focus'

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  mono,
  disabled,
  onKeyDown,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  mono?: boolean
  disabled?: boolean
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      disabled={disabled}
      onKeyDown={onKeyDown}
      onChange={(event) => onChange(event.target.value)}
      className={cx(controlClass, mono && 'font-mono text-[13px]', disabled && 'opacity-50')}
    />
  )
}

export function Textarea({
  value,
  onChange,
  placeholder,
  rows = 6,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      className={cx(controlClass, 'resize-none font-mono text-[13px] leading-relaxed')}
    />
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className={cx(controlClass, 'appearance-none pr-8')}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 rounded-[var(--radius-control)] py-1.5 text-left"
    >
      <span
        className={cx(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-accent' : 'bg-line'
        )}
      >
        <span
          className={cx(
            'size-4 rounded-full bg-white transition-transform',
            checked && 'translate-x-4'
          )}
        />
      </span>
      {label || hint ? (
        <span className="min-w-0">
          {label ? <span className="block text-sm">{label}</span> : null}
          {hint ? <span className="block text-xs text-faint">{hint}</span> : null}
        </span>
      ) : null}
    </button>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'
}) {
  const tones = {
    neutral: 'bg-raised text-dim',
    ok: 'bg-ok/12 text-ok',
    warn: 'bg-warn/12 text-warn',
    danger: 'bg-danger/12 text-danger',
    accent: 'bg-accent-soft text-accent',
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone]
      )}
    >
      {children}
    </span>
  )
}

export function Progress({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function EmptyState({
  icon = 'spark',
  title,
  body,
  action,
}: {
  icon?: string
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-raised text-faint">
        <Icon name={icon} />
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        {body ? <p className="mx-auto mt-1 max-w-sm text-[13px] text-dim">{body}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  wide,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  wide?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={cx(
          'riseIn w-full rounded-[var(--radius-panel)] border border-line bg-surface outline-none',
          wide ? 'max-w-2xl' : 'max-w-lg'
        )}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton icon="close" title="Close" onClick={onClose} />
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-block size-4 animate-spin rounded-full border-2 border-line border-t-accent',
        className
      )}
    />
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="inline-flex rounded-[var(--radius-control)] border border-line bg-bg p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1 text-xs font-medium transition-colors',
            value === option.value ? 'bg-raised text-text' : 'text-faint hover:text-text'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Popover({
  open,
  onClose,
  align = 'left',
  children,
}: {
  open: boolean
  onClose: () => void
  align?: 'left' | 'right'
  children: ReactNode
}) {
  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className={cx(
          'riseIn absolute bottom-full z-50 mb-2 min-w-56 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface p-1.5',
          align === 'right' ? 'right-0' : 'left-0'
        )}
      >
        {children}
      </div>
    </>
  )
}

export function MenuItem({
  children,
  onClick,
  active,
  icon,
  tone = 'neutral',
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
  icon?: string
  tone?: 'neutral' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-[13px] transition-colors',
        tone === 'danger'
          ? 'text-danger hover:bg-danger/10'
          : active
            ? 'bg-raised text-text'
            : 'text-dim hover:bg-raised hover:text-text'
      )}
    >
      {icon ? <Icon name={icon} className="size-4 shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active ? <Icon name="check" className="size-3.5 shrink-0 text-accent" /> : null}
    </button>
  )
}

export type Anchor = { top: number; left: number }

export function anchorFrom(event: React.MouseEvent<HTMLElement>): Anchor {
  const rect = event.currentTarget.getBoundingClientRect()
  return { top: rect.bottom + 6, left: rect.right }
}

export function Menu({
  at,
  onClose,
  children,
}: {
  at: Anchor | null
  onClose: () => void
  children: ReactNode
}) {
  if (!at) return null

  const up = typeof window !== 'undefined' && at.top > window.innerHeight - 220

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        style={up ? { bottom: window.innerHeight - at.top + 34, left: at.left } : { top: at.top, left: at.left }}
        className="riseIn fixed z-50 w-44 -translate-x-full overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface p-1.5"
      >
        {children}
      </div>
    </>
  )
}

export function Ring({
  value,
  total,
  label,
}: {
  value: number
  total: number
  label: string
}) {
  const share = total > 0 ? Math.min(1, value / total) : 0
  const circumference = 2 * Math.PI * 9

  return (
    <span className="flex items-center gap-2" title={label}>
      <svg viewBox="0 0 24 24" className="size-6 -rotate-90">
        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--raised)" strokeWidth="3" />
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
        />
      </svg>
      {label ? <span className="text-[11px] text-faint">{label}</span> : null}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx('block animate-pulse rounded-[var(--radius-control)] bg-raised', className)} />
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-6" onClick={onCancel}>
      <div
        onClick={(event) => event.stopPropagation()}
        className="riseIn w-full max-w-sm rounded-[var(--radius-panel)] border border-line bg-surface p-5"
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-[13px] text-dim">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" tone="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button size="sm" tone="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function Dropdown({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        title={label}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs font-medium text-dim transition-colors hover:bg-raised hover:text-text"
      >
        {value}
        <Icon name="chevron" className="size-3 rotate-90" />
      </button>

      <Popover open={open} onClose={() => setOpen(false)}>
        {children(() => setOpen(false))}
      </Popover>
    </div>
  )
}
