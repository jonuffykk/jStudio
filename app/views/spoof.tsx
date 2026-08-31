'use client'

import { useEffect, useRef, useState } from 'react'
import { accounts as accountsApi, history as historyApi, pickFolder, spoof as spoofApi } from '@/app/lib/ipc'
import { play } from '@/app/lib/sfx'
import { useStore, type SpoofStatus } from '@/app/lib/state'
import { spoofOptions, type RunItem, type RunRecord, type SpoofOptions } from '@/app/lib/schemas'
import type { MessageKey } from '@/app/lib/i18n'
import {
  Badge,
  Button,
  Confirm,
  Spinner,
  EmptyState,
  Field,
  Icon,
  Input,
  IconButton,
  Menu,
  MenuItem,
  Modal,
  Progress,
  Select,
  Skeleton,
  Toggle,
  anchorFrom,
  cx,
  type Anchor,
} from '@/app/ui/primitives'

const labels: Record<SpoofStatus, MessageKey> = {
  found: 'spoof.statusFound',
  downloading: 'spoof.statusDownloading',
  uploading: 'spoof.statusUploading',
  retrying: 'spoof.statusRetrying',
  uploaded: 'spoof.statusUploaded',
  saved: 'spoof.statusSaved',
  cached: 'spoof.statusCached',
  owned: 'spoof.statusOwned',
  failed: 'spoof.statusFailed',
}

const tones: Record<SpoofStatus, 'ok' | 'warn' | 'danger' | 'accent' | 'neutral'> = {
  found: 'neutral',
  downloading: 'accent',
  uploading: 'accent',
  retrying: 'warn',
  uploaded: 'ok',
  saved: 'ok',
  cached: 'neutral',
  owned: 'neutral',
  failed: 'danger',
}

const DAY = 86_400_000

const clock = (value: number) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function bucketOf(value: number): MessageKey {
  const age = Date.now() - value
  if (age < DAY) return 'chat.today'
  if (age < DAY * 2) return 'chat.yesterday'
  if (age < DAY * 7) return 'chat.week'
  return 'chat.older'
}

export function SpoofView() {
  const store = useStore()
  const { settings, status, spoofItems, spoofProgress, spoofRunning, spoofPaused, runs, t } = store

  const [openRun, setOpenRun] = useState<string | null>(store.focusRun)
  const [showSettings, setShowSettings] = useState(false)
  const [found, setFound] = useState<{ id: string; name: string }[] | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const options = settings.spoof
  const account = store.activeAccount()
  const selected = runs.find((run) => run.id === openRun) ?? null

  const log: RunItem[] =
    selected === null
      ? []
      : selected.items.length > 0
        ? selected.items
        : selected.mappings.map((pair) => ({
            id: pair.from,
            name: pair.name,
            status: 'uploaded',
            newId: pair.to,
            reason: '',
            at: 0,
          }))

  useEffect(() => {
    if (spoofRunning) listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [spoofItems, spoofRunning])

  useEffect(() => () => useStore.getState().openRun(null), [])

  const blocked = !status.online
    ? t('spoof.blockedStudio')
    : !options.downloadOnly && !account?.hasApiKey
      ? t('spoof.blockedKey')
      : ''

  const scan = async () => {
    setScanning(true)
    setOpenRun(null)
    play('tap', settings.sounds)

    try {
      const list = await spoofApi.scan(options.selectedOnly)
      setFound(list)
      setChosen(list.map((entry) => entry.id))
      if (list.length === 0) store.toast(t('spoof.foundNone'), 'danger')
    } catch (error) {
      store.toast(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setScanning(false)
    }
  }

  const start = async () => {
    store.resetSpoof()
    setOpenRun(null)
    setFound(null)
    play('send', settings.sounds)
    useStore.setState({ spoofRunning: true, spoofPaused: false })

    try {
      const result = await spoofApi.start({ ...options, only: chosen })
      play(result.failed > 0 ? 'error' : 'done', settings.sounds)
      store.toast(
        `${result.done} ${t('spoof.done')}, ${result.failed} ${t('spoof.failedCount')}`,
        result.failed > 0 ? 'danger' : 'ok'
      )
      await store.refreshRuns()
    } catch (error) {
      play('error', settings.sounds)
      store.toast(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      useStore.setState({ spoofRunning: false, spoofPaused: false, spoofStatus: '' })
    }
  }

  const applyRun = async (run: RunRecord) => {
    try {
      const result = await historyApi.apply(run.id, run.applied)
      play('done', settings.sounds)
      store.toast(`${result.count} ${t('spoof.replaced')}`, 'ok')
      await store.refreshRuns()
    } catch (error) {
      play('error', settings.sounds)
      store.toast(error instanceof Error ? error.message : String(error), 'danger')
    }
  }

  const visible = runs.filter((run) => !run.archived)
  const pinned = visible.filter((run) => run.pinned)
  const loose = visible.filter((run) => !run.pinned)
  const archived = runs.filter((run) => run.archived)

  const buckets: { key: MessageKey; items: RunRecord[] }[] = (
    ['chat.today', 'chat.yesterday', 'chat.week', 'chat.older'] as MessageKey[]
  ).map((key) => ({ key, items: loose.filter((run) => bucketOf(run.startedAt) === key) }))

  return (
    <div className="flex h-full">
      <aside className="flex w-[252px] shrink-0 flex-col border-r border-line bg-surface">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
          <h2 className="text-sm font-semibold">{t('spoof.runs')}</h2>
          <div className="flex items-center">
            <IconButton icon="sliders" title={t('spoof.settings')} onClick={() => setShowSettings(true)} />
            <IconButton icon="plus" title={t('spoof.newRun')} onClick={() => setOpenRun(null)} />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!store.ready ? (
            <div className="space-y-1.5 p-1">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : runs.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-faint">{t('spoof.emptyRuns')}</p>
          ) : (
            <>
              <RunGroup label={t('chat.pinned')} items={pinned} current={openRun} onOpen={setOpenRun} />
              {buckets.map((group) => (
                <RunGroup
                  key={group.key}
                  label={t(group.key)}
                  items={group.items}
                  current={openRun}
                  onOpen={setOpenRun}
                />
              ))}

              {archived.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowArchived(!showArchived)}
                    className="flex w-full items-center gap-1.5 px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-faint transition-colors hover:text-dim"
                  >
                    <Icon
                      name="chevron"
                      className={cx('size-3 transition-transform', showArchived && 'rotate-90')}
                    />
                    {t('chat.archived')}
                  </button>
                  {showArchived ? (
                    <RunGroup label="" items={archived} current={openRun} onOpen={setOpenRun} />
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-5">
          <h1 className="shrink-0 text-sm font-semibold">{t('nav.animations')}</h1>

          {selected ? (
            <>
              <Icon name="chevron" className="size-3.5 shrink-0 text-faint" />
              <span className="truncate text-sm text-dim">{nameOf(selected, t)}</span>
              <IconButton icon="close" title={t('common.cancel')} onClick={() => setOpenRun(null)} />
            </>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            {selected ? (
              selected.mappings.length > 0 ? (
                <>
                  {selected.applied ? (
                    <Button size="sm" tone="ghost" disabled={!status.online} onClick={() => void applyRun(selected)}>
                      {t('spoof.revert')}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    tone="primary"
                    disabled={!status.online}
                    onClick={() => void applyRun({ ...selected, applied: false })}
                  >
                    {t('spoof.apply')}
                  </Button>
                </>
              ) : null
            ) : (
              <>
                {spoofProgress.total > 0 ? (
                  <>
                    <Badge>
                      {spoofProgress.total} {t('spoof.total')}
                    </Badge>
                    <Badge tone="ok">
                      {spoofProgress.done} {t('spoof.done')}
                    </Badge>
                    {spoofProgress.failed > 0 ? (
                      <Badge tone="danger">
                        {spoofProgress.failed} {t('spoof.failedCount')}
                      </Badge>
                    ) : null}
                  </>
                ) : null}

                {found ? (
                  <>
                    <span className="text-[13px] text-dim">
                      {chosen.length}/{found.length}
                    </span>
                    <Button size="sm" tone="ghost" onClick={() => setFound(null)}>
                      {t('common.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      tone="primary"
                      icon="play"
                      disabled={chosen.length === 0}
                      onClick={() => void start()}
                    >
                      {t('spoof.run')}
                    </Button>
                  </>
                ) : spoofRunning ? (
                  <>
                    <IconButton
                      icon={spoofPaused ? 'play' : 'pause'}
                      title={spoofPaused ? t('spoof.resume') : t('spoof.pause')}
                      onClick={() => {
                        if (spoofPaused) void spoofApi.resume()
                        else void spoofApi.pause()
                        useStore.setState({ spoofPaused: !spoofPaused })
                      }}
                    />
                    <IconButton
                      icon="stop"
                      tone="danger"
                      title={t('spoof.stop')}
                      onClick={() => void spoofApi.stop()}
                    />
                  </>
                ) : scanning ? (
                  <span className="flex items-center gap-2 text-[13px] text-faint">
                    <Spinner className="size-3.5" />
                    {t('spoof.scanning')}
                  </span>
                ) : (
                  <IconButton
                    icon="play"
                    title={blocked || t('spoof.run')}
                    disabled={!!blocked}
                    onClick={() => void scan()}
                  />
                )}
              </>
            )}
          </div>
        </header>

        {spoofRunning && !selected ? (
          <Progress value={spoofProgress.done + spoofProgress.failed} total={Math.max(spoofProgress.total, 1)} />
        ) : null}

        {blocked && !spoofRunning && !selected ? (
          <p className="border-b border-line bg-warn/10 px-5 py-2 text-[13px] text-warn">{blocked}</p>
        ) : null}

        {selected ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <Badge tone="ok">
                {selected.done} {t('spoof.done')}
              </Badge>
              {selected.failed > 0 ? (
                <Badge tone="danger">
                  {selected.failed} {t('spoof.failedCount')}
                </Badge>
              ) : null}
              {selected.applied ? <Badge tone="accent">{t('build.applied')}</Badge> : null}
              {selected.target ? <Badge>{selected.target}</Badge> : null}
              <span className="text-xs text-faint">{new Date(selected.startedAt).toLocaleString()}</span>
            </div>

            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">
              {t('spoof.log')} · {log.length}
            </p>

            {log.length === 0 ? (
              <EmptyState icon="clock" title={t('home.empty')} />
            ) : (
              <ul
                data-selectable
                className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface"
              >
                {log.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]">{entry.name || entry.id}</p>
                      <p className="truncate font-mono text-xs text-faint">
                        {entry.id}
                        {entry.newId ? ` → ${entry.newId}` : ''}
                      </p>
                    </div>
                    {entry.reason ? <span className="text-xs text-danger">{entry.reason}</span> : null}
                    <Badge tone={tones[entry.status as SpoofStatus] ?? 'neutral'}>
                      {labels[entry.status as SpoofStatus] ? t(labels[entry.status as SpoofStatus]!) : entry.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : found ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex items-center gap-3 border-b border-line px-5 py-2.5">
              <button
                type="button"
                onClick={() => setChosen(chosen.length === found.length ? [] : found.map((entry) => entry.id))}
                className="text-[13px] text-dim transition-colors hover:text-text"
              >
                {chosen.length === found.length ? t('spoof.selectNone') : t('spoof.selectAll')}
              </button>
              <span className="ml-auto text-xs text-faint">{t('spoof.pickHint')}</span>
            </div>

            <ul className="divide-y divide-line">
              {found.map((item) => {
                const picked = chosen.includes(item.id)

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setChosen(
                          picked ? chosen.filter((entry) => entry !== item.id) : [...chosen, item.id]
                        )
                      }
                      className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-raised"
                    >
                      <span
                        className={cx(
                          'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                          picked ? 'border-accent bg-accent text-white' : 'border-focus'
                        )}
                      >
                        {picked ? <Icon name="check" className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cx('block truncate text-[13px]', !picked && 'text-faint')}>
                          {item.name}
                        </span>
                        <span className="block truncate font-mono text-xs text-faint">{item.id}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {spoofItems.length === 0 ? (
              <EmptyState icon="film" title={t('spoof.empty')} />
            ) : (
              <ul className="divide-y divide-line">
                {spoofItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-raised"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]">{item.name}</p>
                      <p className="truncate font-mono text-xs text-faint">
                        {item.id}
                        {item.newId ? ` → ${item.newId}` : ''}
                      </p>
                    </div>
                    {item.reason ? <span className="text-xs text-danger">{item.reason}</span> : null}
                    <Badge tone={tones[item.status]}>{t(labels[item.status])}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {showSettings ? <SpoofSettings onClose={() => setShowSettings(false)} /> : null}
    </div>
  )
}

function nameOf(run: RunRecord, t: (key: MessageKey, values?: Record<string, string | number>) => string): string {
  if (run.label) return run.label
  if (run.downloadOnly) return t('spoof.runDownloaded', { count: run.done })
  return t('spoof.runReplaced', { count: run.done })
}

function RunGroup({
  label,
  items,
  current,
  onOpen,
}: {
  label: string
  items: RunRecord[]
  current: string | null
  onOpen: (id: string) => void
}) {
  if (items.length === 0) return null

  return (
    <>
      {label ? (
        <p className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      ) : null}
      <ul className="space-y-0.5">
        {items.map((run) => (
          <RunRow key={run.id} run={run} active={run.id === current} onOpen={() => onOpen(run.id)} />
        ))}
      </ul>
    </>
  )
}

function RunRow({ run, active, onOpen }: { run: RunRecord; active: boolean; onOpen: () => void }) {
  const store = useStore()
  const { t } = store
  const [at, setAt] = useState<Anchor | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [label, setLabel] = useState(() => nameOf(run, t))

  if (renaming) {
    return (
      <li>
        <input
          autoFocus
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && label.trim()) {
              void store.patchRun(run.id, { label: label.trim() })
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
        {run.pinned ? <Icon name="pin" className="size-3 shrink-0" /> : null}
        <span className="min-w-0 flex-1 truncate">{nameOf(run, t)}</span>
        <span className="shrink-0 text-[11px] text-faint" title={new Date(run.startedAt).toLocaleString()}>
          {clock(run.startedAt)}
        </span>
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
          icon={run.pinned ? 'unpin' : 'pin'}
          onClick={() => {
            void store.patchRun(run.id, { pinned: !run.pinned })
            setAt(null)
          }}
        >
          {run.pinned ? t('chat.unpin') : t('chat.pin')}
        </MenuItem>
        <MenuItem
          icon="archive"
          onClick={() => {
            void store.patchRun(run.id, { archived: !run.archived })
            setAt(null)
          }}
        >
          {run.archived ? t('chat.unarchive') : t('chat.archive')}
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
        title={`${t('common.delete')} · ${nameOf(run, t)}`}
        body={t('common.confirmDelete')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          void store.removeRun(run.id)
        }}
      />
    </li>
  )
}

function SpoofSettings({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const { settings, status, t } = store
  const options = settings.spoof

  const [groups, setGroups] = useState<{ id: string; name: string }[]>([])
  const [loadedGroups, setLoadedGroups] = useState(false)

  useEffect(() => {
    let live = true
    accountsApi
      .groups()
      .then((list) => {
        if (live) setGroups(list)
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoadedGroups(true)
      })

    return () => {
      live = false
    }
  }, [])

  const patch = (change: Partial<SpoofOptions>) =>
    void store.patchSettings({ spoof: spoofOptions.parse({ ...options, ...change }) })

  return (
    <Modal open onClose={onClose} title={t('spoof.settings')}>
      <div className="space-y-5">
        <Group title={t('spoof.mode')}>
          <Choice
            active={!options.downloadOnly}
            label={t('spoof.upload')}
            onClick={() => patch({ downloadOnly: false })}
          />
          <Choice
            active={options.downloadOnly}
            label={t('spoof.downloadOnly')}
            onClick={() => patch({ downloadOnly: true })}
          />
        </Group>

        <Group title={t('spoof.scope')}>
          <Choice
            active={!options.selectedOnly}
            label={t('spoof.wholePlace')}
            onClick={() => patch({ selectedOnly: false })}
          />
          <Choice
            active={options.selectedOnly}
            label={t('spoof.selectionShort')}
            detail={status.selectionCount > 0 ? `${status.selectionCount}` : undefined}
            onClick={() => patch({ selectedOnly: true })}
          />
        </Group>

        {options.downloadOnly ? (
          <Field label={t('spoof.folder')}>
            <div className="flex gap-2">
              <Input
                value={options.downloadFolder}
                onChange={(value) => patch({ downloadFolder: value })}
                mono
              />
              <Button
                size="sm"
                onClick={async () => {
                  const folder = await pickFolder()
                  if (folder) patch({ downloadFolder: folder })
                }}
              >
                {t('spoof.choose')}
              </Button>
            </div>
          </Field>
        ) : (
          <Field label={t('spoof.target')} hint={loadedGroups ? undefined : t('spoof.checkingGroups')}>
            <Select
              value={options.groupId}
              onChange={(value) => patch({ groupId: value })}
              options={[
                { value: '', label: t('spoof.myProfile') },
                ...groups.map((group) => ({ value: group.id, label: group.name })),
              ]}
            />
          </Field>
        )}

        <Group title={t('spoof.advanced')}>
          <Toggle
            checked={options.forceReupload}
            onChange={(value) => patch({ forceReupload: value })}
            label={t('spoof.forceReupload')}
          />
          <Toggle
            checked={options.autoName}
            onChange={(value) => patch({ autoName: value })}
            label={t('spoof.autoName')}
          />
          <Field label={t('spoof.placeOverride')}>
            <Input
              value={options.overridePlaceId}
              onChange={(value) => patch({ overridePlaceId: value.replace(/\D/g, '') })}
              mono
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('spoof.downloads')}>
              <Input
                type="number"
                value={String(options.downloadConcurrency)}
                onChange={(value) => patch({ downloadConcurrency: Number(value) || 8 })}
              />
            </Field>
            <Field label={t('spoof.uploads')}>
              <Input
                type="number"
                value={String(options.uploadConcurrency)}
                onChange={(value) => patch({ uploadConcurrency: Number(value) || 6 })}
              />
            </Field>
            <Field label={t('spoof.retries')}>
              <Input
                type="number"
                value={String(options.uploadRetries)}
                onChange={(value) => patch({ uploadRetries: Number(value) || 3 })}
              />
            </Field>
          </div>
        </Group>
      </div>
    </Modal>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-faint">{title}</h3>
      {children}
    </section>
  )
}

function Choice({
  active,
  label,
  detail,
  onClick,
}: {
  active: boolean
  label: string
  detail?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-[var(--radius-control)] border px-3 py-2 text-left text-[13px] transition-colors',
        active
          ? 'border-focus bg-accent-soft text-accent'
          : 'border-line text-dim hover:border-focus hover:bg-raised'
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-focus">
        {active ? <span className="size-2 rounded-full bg-accent" /> : null}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      {detail ? <Badge tone="accent">{detail}</Badge> : null}
    </button>
  )
}
