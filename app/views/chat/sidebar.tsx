'use client'

import { useMemo, useState } from 'react'
import type { Conversation } from '@/app/lib/schemas'
import { useStore } from '@/app/lib/state'
import type { MessageKey } from '@/app/lib/i18n'
import {
  Confirm,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  Skeleton,
  anchorFrom,
  cx,
  type Anchor,
} from '@/app/ui/primitives'
import { DAY } from '@/app/views/chat/types'

function bucketOf(value: number): MessageKey {
  const age = Date.now() - value
  if (age < DAY) return 'chat.today'
  if (age < DAY * 2) return 'chat.yesterday'
  if (age < DAY * 7) return 'chat.week'
  return 'chat.older'
}

function ChatGroup({
  label,
  items,
  current,
  running,
  onOpen,
  onNew,
}: {
  label: string
  items: Conversation[]
  current: string
  running: string[]
  onOpen: (conversation: Conversation) => void
  onNew: () => void
}) {
  if (items.length === 0) return null

  return (
    <>
      {label ? (
        <p className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      ) : null}
      <ul className="space-y-0.5">
        {items.map((conversation) => (
          <ChatRow
            key={conversation.id}
            conversation={conversation}
            active={conversation.id === current}
            running={running.includes(conversation.id)}
            onOpen={() => onOpen(conversation)}
            onNew={onNew}
          />
        ))}
      </ul>
    </>
  )
}

function ChatRow({
  conversation,
  active,
  running,
  onOpen,
  onNew,
}: {
  conversation: Conversation
  active: boolean
  running: boolean
  onOpen: () => void
  onNew: () => void
}) {
  const store = useStore()
  const { t } = store
  const [at, setAt] = useState<Anchor | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [title, setTitle] = useState(conversation.title)

  const save = (patch: Partial<Conversation>) => void store.saveConversation({ ...conversation, ...patch })

  if (renaming) {
    return (
      <li>
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && title.trim()) {
              save({ title: title.trim() })
              window.dispatchEvent(new CustomEvent('jstudio:renamed', { detail: conversation.id }))
              setRenaming(false)
            }
            if (event.key === 'Escape') setRenaming(false)
          }}
          className="w-full rounded-[var(--radius-control)] border border-line bg-bg px-2 py-1.5 text-[13px] outline-none"
        />
      </li>
    )
  }

  return (
    <li
      className={cx(
        'group relative rounded-[var(--radius-control)] transition-colors',
        active ? 'bg-accent-soft' : 'hover:bg-raised'
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cx(
          'flex w-full items-center gap-1.5 truncate rounded-[var(--radius-control)] py-2 pl-2.5 pr-9 text-left text-[13px] transition-colors',
          active ? 'text-accent' : 'text-dim group-hover:text-text'
        )}
      >
        {running ? (
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
        ) : conversation.pinned ? (
          <Icon name="pin" className="size-3 shrink-0" />
        ) : null}
        <span className="truncate">{conversation.title}</span>
      </button>

      <span
        className={cx(
          'absolute right-1 top-1/2 -translate-y-1/2 transition-opacity',
          at ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <IconButton
          icon="menu"
          tone="plain"
          size="sm"
          title={t('build.rename')}
          onClick={(event) => setAt(at ? null : anchorFrom(event))}
        />
      </span>

      <Menu at={at} onClose={() => setAt(null)}>
        <MenuItem
          icon="edit"
          onClick={() => {
            setRenaming(true)
            setAt(null)
          }}
        >
          {t('build.rename')}
        </MenuItem>
        <MenuItem
          icon={conversation.pinned ? 'unpin' : 'pin'}
          onClick={() => {
            save({ pinned: !conversation.pinned })
            setAt(null)
          }}
        >
          {conversation.pinned ? t('chat.unpin') : t('chat.pin')}
        </MenuItem>
        <MenuItem
          icon="archive"
          onClick={() => {
            save({ archived: !conversation.archived })
            setAt(null)
          }}
        >
          {conversation.archived ? t('chat.unarchive') : t('chat.archive')}
        </MenuItem>
        <MenuItem
          icon="trash"
          tone="danger"
          onClick={() => {
            setAt(null)
            setConfirming(true)
          }}
        >
          {t('common.delete')}
        </MenuItem>
      </Menu>

      <Confirm
        open={confirming}
        title={`${t('common.delete')} · ${conversation.title}`}
        body={t('common.confirmDelete')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          void store.deleteConversation(conversation.id)
          if (active) onNew()
        }}
      />
    </li>
  )
}

export function ChatSidebar({
  current,
  running,
  ready,
  onOpen,
  onNew,
}: {
  current: string
  running: string[]
  ready: boolean
  onOpen: (conversation: Conversation) => void
  onNew: () => void
}) {
  const { conversations, t } = useStore()
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const needle = query.trim().toLowerCase()

  const matches = useMemo(() => {
    if (!needle) return conversations
    return conversations.filter(
      (entry) =>
        entry.title.toLowerCase().includes(needle) ||
        entry.messages.some((message) => message.content.toLowerCase().includes(needle))
    )
  }, [conversations, needle])

  const visible = matches.filter((entry) => !entry.archived)
  const pinned = visible.filter((entry) => entry.pinned)
  const loose = visible.filter((entry) => !entry.pinned)
  const archived = matches.filter((entry) => entry.archived)

  const buckets: { key: MessageKey; items: Conversation[] }[] = (
    ['chat.today', 'chat.yesterday', 'chat.week', 'chat.older'] as MessageKey[]
  ).map((key) => ({ key, items: loose.filter((entry) => bucketOf(entry.updatedAt) === key) }))

  return (
    <aside className="flex w-[252px] shrink-0 flex-col border-r border-line bg-surface">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
        <h2 className="text-sm font-semibold">{t('build.conversations')}</h2>
        <IconButton icon="plus" title={t('build.newChat')} onClick={onNew} />
      </header>

      <div className="shrink-0 px-2 pt-2">
        <label className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-bg px-2 py-1.5 focus-within:border-focus">
          <Icon name="search" className="size-3.5 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('build.search')}
            aria-label={t('build.search')}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
          {query ? (
            <IconButton size="sm" tone="plain" icon="close" title={t('common.cancel')} onClick={() => setQuery('')} />
          ) : null}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!ready ? (
          <div className="space-y-1.5 p-1">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : (
          <>
            <ChatGroup
              label={t('chat.pinned')}
              items={pinned}
              current={current}
              running={running}
              onOpen={onOpen}
              onNew={onNew}
            />

            {buckets.map((group) => (
              <ChatGroup
                key={group.key}
                label={t(group.key)}
                items={group.items}
                current={current}
                running={running}
                onOpen={onOpen}
                onNew={onNew}
              />
            ))}

            {archived.length > 0 ? (
              <>
                <button
                  type="button"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived(!showArchived)}
                  className="flex w-full items-center gap-1.5 px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-faint transition-colors hover:text-dim"
                >
                  <Icon name="chevron" className={cx('size-3 transition-transform', showArchived && 'rotate-90')} />
                  {t('chat.archived')}
                </button>
                {showArchived ? (
                  <ChatGroup
                    label=""
                    items={archived}
                    current={current}
                    running={running}
                    onOpen={onOpen}
                    onNew={onNew}
                  />
                ) : null}
              </>
            ) : null}

            {needle && visible.length + archived.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px] text-faint">{t('build.noMatches')}</p>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
