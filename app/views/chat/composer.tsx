'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { groupModels } from '@/app/lib/models'
import { useCatalog } from '@/app/ui/modelSelect'
import type { Skill } from '@/app/lib/schemas'
import { useStore } from '@/app/lib/state'
import type { MessageKey } from '@/app/lib/i18n'
import {
  Dropdown,
  Icon,
  IconButton,
  MenuItem,
  Popover,
  Skeleton,
  cx,
} from '@/app/ui/primitives'

export const commands: { name: string; hint: MessageKey }[] = [
  { name: 'compress', hint: 'build.compressHint' },
  { name: 'status', hint: 'build.statusTitle' },
  { name: 'tools', hint: 'settings.tools' },
]

const modeLabels: Record<'manual' | 'auto' | 'plan', MessageKey> = {
  manual: 'settings.modeManual',
  auto: 'settings.modeAuto',
  plan: 'settings.modePlan',
}

const effortLabels: Record<'low' | 'medium' | 'high', MessageKey> = {
  low: 'settings.effortLow',
  medium: 'settings.effortMedium',
  high: 'settings.effortHigh',
}

export function complete(draft: string, name: string): string {
  return draft.replace(/(?:^|\s)\/[a-z0-9-]*$/i, (match) => `${match.startsWith('/') ? '' : ' '}/${name} `)
}

export function highlight(draft: string, skills: Skill[]): ReactNode[] {
  const names = [...commands.map((entry) => entry.name), ...skills.map((entry) => entry.name)]
  const pattern = new RegExp(`(?:/(?:${names.join('|')})\\b)|(?:@[A-Za-z_][\\w]*(?:\\.[A-Za-z_][\\w ]*)+)`, 'gi')

  const parts: ReactNode[] = []
  let cursor = 0

  for (const match of draft.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > cursor) parts.push(draft.slice(cursor, at))
    parts.push(
      <span key={at} className="rounded bg-accent-soft">
        {match[0]}
      </span>
    )
    cursor = at + match[0].length
  }

  parts.push(draft.slice(cursor))
  return parts
}

function SlashMenu({
  open,
  skills,
  matches,
  onPick,
}: {
  open: boolean
  skills: Skill[]
  matches: { name: string; hint: MessageKey }[]
  onPick: (name: string) => void
}) {
  const { t } = useStore()
  if (!open) return null

  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-96 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface p-1.5">
      {matches.map((entry) => (
        <MenuItem key={entry.name} icon="plan" onClick={() => onPick(entry.name)}>
          <span className="font-mono">/{entry.name}</span>
          <span className="ml-2 text-xs text-faint">{t(entry.hint)}</span>
        </MenuItem>
      ))}

      {skills.slice(0, 6).map((entry) => (
        <MenuItem key={entry.id} icon="spark" onClick={() => onPick(entry.name)}>
          <span className="font-mono">/{entry.name}</span>
          <span className="ml-2 truncate text-xs text-faint">{entry.description}</span>
        </MenuItem>
      ))}
    </div>
  )
}

export function ModelPicker({
  open,
  value,
  onOpenChange,
  onPick,
}: {
  open: boolean
  value: string
  onOpenChange: (open: boolean) => void
  onPick: (model: string) => void
}) {
  const { t } = useStore()
  const { list, loading } = useCatalog()
  const [query, setQuery] = useState('')

  const needle = query.trim().toLowerCase()
  const matches = needle ? list.filter((entry) => entry.id.toLowerCase().includes(needle)) : list
  const groups = groupModels(matches)

  return (
    <div className="relative">
      <button
        type="button"
        title="Ctrl+I"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex h-8 max-w-60 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs text-dim transition-colors hover:bg-raised hover:text-text"
      >
        <span className="truncate">{value || t('build.model')}</span>
        <Icon name="chevron" className="size-3 shrink-0 rotate-90" />
      </button>

      <Popover open={open} onClose={() => onOpenChange(false)}>
        <div className="w-80">
          <div className="border-b border-line p-1.5">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('settings.searchModels')}
              aria-label={t('settings.searchModels')}
              className="w-full rounded-[var(--radius-control)] bg-raised px-2 py-1.5 text-[13px] outline-none placeholder:text-faint"
            />
          </div>

          <div className="max-h-80 overflow-y-auto p-1.5">
            {loading && list.length === 0 ? (
              <div className="space-y-1.5">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
            ) : groups.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px] text-faint">{t('settings.noModels')}</p>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  <p className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-faint">
                    {group.label}
                  </p>

                  {group.models.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onPick(entry.id)
                        onOpenChange(false)
                      }}
                      className={cx(
                        'w-full rounded-[var(--radius-control)] px-2.5 py-1.5 text-left transition-colors',
                        entry.id === value ? 'bg-raised' : 'hover:bg-raised'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px]">{entry.id}</span>
                        {entry.free ? <span className="shrink-0 text-[11px] text-ok">{t('settings.free')}</span> : null}
                        {entry.id === value ? (
                          <Icon name="check" className="size-3.5 shrink-0 text-accent" />
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </Popover>
    </div>
  )
}

export function Composer({
  draft,
  images,
  busy,
  answering,
  sighted,
  model,
  usage,
  onDraft,
  onDropImages,
  onRemoveImage,
  onSend,
  onStop,
  onModel,
}: {
  draft: string
  images: string[]
  busy: boolean
  answering: boolean
  sighted: boolean
  model: string
  usage: ReactNode
  onDraft: (value: string) => void
  onDropImages: (files: FileList | File[]) => void
  onRemoveImage: (index: number) => void
  onSend: () => void
  onStop: () => void
  onModel: (model: string) => void
}) {
  const store = useStore()
  const { settings, t } = store
  const fileInput = useRef<HTMLInputElement>(null)
  const [modelOpen, setModelOpen] = useState(false)

  useEffect(() => {
    const onPick = () => setModelOpen(true)
    window.addEventListener('jstudio:pickModel', onPick)
    return () => window.removeEventListener('jstudio:pickModel', onPick)
  }, [])

  const typing = /(?:^|\s)\/([a-z0-9-]*)$/i.exec(draft)?.[1]
  const skillMatches =
    typing === undefined
      ? []
      : settings.skills.filter((entry) => entry.name.toLowerCase().includes(typing.toLowerCase()))
  const commandMatches =
    typing === undefined ? [] : commands.filter((entry) => entry.name.startsWith(typing.toLowerCase()))

  return (
    <div className="relative rounded-[var(--radius-panel)] border border-line bg-bg transition-colors focus-within:border-focus">
      <SlashMenu
        open={skillMatches.length + commandMatches.length > 0}
        skills={skillMatches}
        matches={commandMatches}
        onPick={(name) => onDraft(complete(draft, name))}
      />

      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-b border-line p-2">
          {images.map((image, index) => (
            <span key={index} className="relative">
              <img src={image} alt="" className="size-12 rounded-[var(--radius-control)] object-cover" />
              <button
                type="button"
                title={t('common.delete')}
                onClick={() => onRemoveImage(index)}
                className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-line bg-surface text-dim transition-colors hover:text-danger"
              >
                <Icon name="close" className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 max-h-56 min-h-20 overflow-hidden whitespace-pre-wrap break-words px-3.5 py-3 text-sm text-transparent"
        >
          {highlight(draft, settings.skills)}
        </div>

        <textarea
          value={draft}
          rows={3}
          aria-label={t('build.placeholder')}
          placeholder={answering ? t('build.answerHint') : t('build.placeholder')}
          onChange={(event) => onDraft(event.target.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files]
            if (files.length > 0) {
              event.preventDefault()
              onDropImages(files)
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            const wants = settings.sendOnEnter ? !event.shiftKey : event.ctrlKey || event.metaKey
            if (!wants) return

            event.preventDefault()
            const first = commandMatches[0]?.name ?? skillMatches[0]?.name
            if (typing !== undefined && first) {
              onDraft(complete(draft, first))
              return
            }
            onSend()
          }}
          className="relative max-h-56 min-h-20 w-full resize-none bg-transparent px-3.5 py-3 text-sm outline-none placeholder:text-faint"
        />
      </div>

      <div className="flex items-center gap-1 border-t border-line px-2 py-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) onDropImages(event.target.files)
            event.target.value = ''
          }}
        />
        <IconButton
          icon="image"
          title={sighted ? t('build.attach') : t('build.attachBlind', { model })}
          disabled={!sighted}
          onClick={() => fileInput.current?.click()}
        />

        <ModelPicker open={modelOpen} value={model} onOpenChange={setModelOpen} onPick={onModel} />

        <span className="mx-1 h-5 w-px shrink-0 bg-line" />

        <Dropdown label={t('settings.mode')} value={t(modeLabels[settings.mode])}>
          {(close) =>
            (['manual', 'auto', 'plan'] as const).map((mode) => (
              <MenuItem
                key={mode}
                active={settings.mode === mode}
                onClick={() => {
                  void store.patchSettings({ mode })
                  close()
                }}
              >
                {t(modeLabels[mode])}
              </MenuItem>
            ))
          }
        </Dropdown>

        <Dropdown label={t('settings.effort')} value={t(effortLabels[settings.effort])}>
          {(close) =>
            (['low', 'medium', 'high'] as const).map((effort) => (
              <MenuItem
                key={effort}
                active={settings.effort === effort}
                onClick={() => {
                  void store.patchSettings({ effort })
                  close()
                }}
              >
                {t(effortLabels[effort])}
              </MenuItem>
            ))
          }
        </Dropdown>

        <span className="ml-auto flex items-center gap-1">
          {usage}
          <button
            type="button"
            title={busy ? t('build.stop') : t('build.send')}
            disabled={!busy && !draft.trim() && images.length === 0}
            onClick={() => (busy ? onStop() : onSend())}
            className={cx(
              'flex size-8 items-center justify-center rounded-[var(--radius-control)] text-white transition-colors disabled:pointer-events-none disabled:opacity-40',
              busy ? 'bg-danger hover:bg-danger/85' : 'bg-accent hover:bg-accent-hover'
            )}
          >
            <Icon name={busy ? 'square' : 'chevron'} className={cx('size-4', !busy && '-rotate-90')} />
          </button>
        </span>
      </div>
    </div>
  )
}
