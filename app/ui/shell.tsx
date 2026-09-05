'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { accounts as accountsApi, appWindow, plugin as pluginApi } from '@/app/lib/ipc'
import { play, unlockAudio } from '@/app/lib/host'
import { useStore, type View } from '@/app/lib/state'
import { Button, Confirm, Icon, IconButton, cx } from '@/app/ui/primitives'
import { OnboardingView } from '@/app/views/onboarding'
import { HomeView } from '@/app/views/home'
import { BuildView } from '@/app/views/build'
import { AssetsView } from '@/app/views/assets'
import { AccountsModal } from '@/app/views/accountsModal'
import { SettingsModal } from '@/app/views/settingsModal'
import type { MessageKey } from '@/app/lib/i18n'

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

const navigation: { view: View; icon: string; label: MessageKey }[] = [
  { view: 'home', icon: 'home', label: 'nav.home' },
  { view: 'build', icon: 'build', label: 'nav.build' },
  { view: 'assets', icon: 'assets', label: 'nav.assets' },
]

/**
 * A cancelled request leaves the host holding a resource nobody owns, and the
 * plugin reports that as a rejection with no owner. It is noise, not a crash,
 * and this is installed at load so nothing can reject before it.
 */
const harmless = /resource id .* is invalid|abort(ed)?|AbortError|The operation was aborted/i

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string; name?: string } | undefined
    const text = String(reason?.message ?? reason?.name ?? event.reason ?? '')
    if (harmless.test(text)) event.preventDefault()
  })
}

export function Shell() {
  const store = useStore()

  useEffect(() => {
    void store.bootstrap()
    window.addEventListener('pointerdown', unlockAudio, { once: true })
    return () => window.removeEventListener('pointerdown', unlockAudio)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const typingIn = (target: EventTarget | null) => {
      const node = target as HTMLElement | null
      return !!node?.closest('input, textarea, [contenteditable="true"]')
    }

    const onKey = (event: KeyboardEvent) => {
      const state = useStore.getState()
      const key = event.key.toLowerCase()

      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
      if (!state.settings.onboarded) return
      if (typingIn(event.target) && !['k', 'b', ','].includes(key)) return

      const views: View[] = ['home', 'build', 'assets']
      const view = views[Number(key) - 1]

      if (view) {
        event.preventDefault()
        state.setView(view)
      } else if (key === 'k') {
        event.preventDefault()
        state.setPalette(!state.paletteOpen)
      } else if (key === 'b') {
        event.preventDefault()
        state.setRail(!state.railOpen)
      } else if (key === 'i') {
        event.preventDefault()
        state.setView('build')
        window.dispatchEvent(new CustomEvent('jstudio:pickModel'))
      } else if (key === 'm') {
        event.preventDefault()
        const modes = ['manual', 'auto', 'plan'] as const
        const next = modes[(modes.indexOf(state.settings.mode) + 1) % modes.length] ?? 'manual'
        void state.patchSettings({ mode: next })
        state.toast(`${state.t('settings.mode')} · ${state.t(modeLabels[next])}`, 'ok')
      } else if (key === 'e') {
        event.preventDefault()
        const efforts = ['low', 'medium', 'high'] as const
        const next = efforts[(efforts.indexOf(state.settings.effort) + 1) % efforts.length] ?? 'medium'
        void state.patchSettings({ effort: next })
        state.toast(`${state.t('settings.effort')} · ${state.t(effortLabels[next])}`, 'ok')
      } else if (key === ',') {
        event.preventDefault()
        state.setModal('settings')
      } else if (key === 'z') {
        event.preventDefault()
        state.goBack()
      } else if (key === 'y') {
        event.preventDefault()
        state.goForward()
      } else if (key === 'n') {
        event.preventDefault()
        state.setView('build')
        window.dispatchEvent(new CustomEvent('jstudio:newChat'))
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!store.booted) return <Splash />

  const blocked = !store.settings.onboarded

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <TitleBar blocked={blocked} />

      {blocked ? (
        <OnboardingView />
      ) : (
        <div className="flex min-h-0 flex-1">
          {store.railOpen ? <Sidebar /> : null}
          <main className="min-w-0 flex-1 overflow-hidden">
            <Pane active={store.view === 'home'}>
              <HomeView />
            </Pane>
            <Pane active={store.view === 'build'}>
              {store.aiReady() ? <BuildView /> : <StillNeeded need="build" />}
            </Pane>
            <Pane active={store.view === 'assets'}>
              {!store.robloxReady() ? (
                <StillNeeded need="animations" />
              ) : !store.cloudReady() ? (
                <StillNeeded need="cloud" />
              ) : (
                <AssetsView />
              )}
            </Pane>
          </main>
        </div>
      )}

      {!blocked && store.modal === 'accounts' ? <AccountsModal /> : null}
      {!blocked && store.modal === 'settings' ? <SettingsModal /> : null}
      <Toasts />
      <CommandPalette />
    </div>
  )
}

function Pane({ active, children }: { active: boolean; children: ReactNode }) {
  return <div className={cx('h-full', active ? 'riseIn' : 'hidden')}>{children}</div>
}

function Splash() {
  const { t } = useStore()

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen flex-col items-center justify-center gap-4 bg-bg text-text"
    >
      <img src="/logo.png" alt="" width={64} height={64} className="riseIn rounded-2xl" />

      <div className="riseIn text-center">
        <h1 className="text-lg font-semibold tracking-tight">jStudio</h1>
        <p className="mt-1 text-[13px] text-dim">{t('splash.tagline')}</p>
      </div>

      <div className="mt-2 h-px w-44 overflow-hidden rounded-full bg-line">
        <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
      </div>

      <p className="text-xs text-faint">{t('splash.loading')}</p>

      <style>{'@keyframes slide{0%{transform:translateX(-110%)}100%{transform:translateX(330%)}}'}</style>
    </div>
  )
}

function TitleBar({ blocked }: { blocked: boolean }) {
  const store = useStore()
  const { t } = store

  return (
    <header
      data-tauri-drag-region
      className="relative flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface pl-4 pr-1"
    >
      <div data-tauri-drag-region className="flex shrink-0 items-center gap-2.5">
        <img src="/logo.png" alt="" width={20} height={20} className="rounded" />
        <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight">
          jStudio
        </span>
      </div>

      {blocked ? null : (
        <>
          <div className="flex shrink-0 items-center">
            <IconButton
              icon="sidebar"
              title={`${t('header.sidebar')} · Ctrl+B`}
              onClick={() => store.setRail(!store.railOpen)}
            />
            <IconButton
              icon="undo"
              title={`${t('header.back')} · Ctrl+Z`}
              disabled={!store.canBack()}
              onClick={() => store.goBack()}
            />
            <IconButton
              icon="redo"
              title={`${t('header.forward')} · Ctrl+Y`}
              disabled={!store.canForward()}
              onClick={() => store.goForward()}
            />
          </div>

          <button
            type="button"
            onClick={() => store.setPalette(true)}
            className="absolute left-1/2 flex h-7 w-full max-w-md -translate-x-1/2 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-bg px-3 text-xs text-faint transition-colors hover:border-focus hover:text-dim"
          >
            <Icon name="search" className="size-3.5" />
            <span className="truncate">{t('header.search')}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px]">Ctrl K</span>
          </button>
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <IconButton size="sm" icon="minus" title="Minimize" onClick={() => void appWindow.minimize()} />
        <IconButton size="sm" icon="square" title="Maximize" onClick={() => void appWindow.toggleMaximize()} />
        <IconButton size="sm" icon="close" title="Close" onClick={() => void appWindow.close()} />
      </div>
    </header>
  )
}

function Sidebar() {
  const store = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const account = store.activeAccount()

  const menu: { modal: 'accounts' | 'settings'; icon: string; label: MessageKey }[] = [
    { modal: 'settings', icon: 'settings', label: 'menu.settings' },
    { modal: 'accounts', icon: 'user', label: 'menu.accounts' },
  ]

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center border-r border-line bg-surface py-2.5">
      <div className="flex flex-1 flex-col items-center gap-1">
        {navigation.map((entry, index) => (
          <button
            key={entry.view}
            type="button"
            title={`${store.t(entry.label)} · Ctrl+${index + 1}`}
            onClick={() => {
              play('tap', store.settings.sounds)
              store.setView(entry.view)
            }}
            className={cx(
              'flex size-10 items-center justify-center rounded-[var(--radius-control)] transition-colors',
              store.view === entry.view
                ? 'bg-accent-soft text-accent'
                : 'text-faint hover:bg-raised hover:text-text'
            )}
          >
            <Icon name={entry.icon} />
          </button>
        ))}
      </div>

      <div className="relative">
        <button
          type="button"
          title={account?.name}
          onClick={() => setMenuOpen(!menuOpen)}
          className={cx(
            'flex size-9 items-center justify-center overflow-hidden rounded-full border transition-colors',
            menuOpen ? 'border-focus' : 'border-line hover:border-focus'
          )}
        >
          {account?.avatarUrl ? (
            <img src={account.avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            <Icon name="user" className="text-faint" />
          )}
        </button>

        {menuOpen ? (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="riseIn absolute bottom-0 left-14 z-50 w-52 -translate-y-[5%] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface p-1.5">
              {account ? (
                <div className="mb-1 flex items-center gap-2.5 border-b border-line px-2.5 pb-2 pt-1.5">
                  {account.avatarUrl ? (
                    <img src={account.avatarUrl} alt="" className="size-8 shrink-0 rounded-full" />
                  ) : (
                    <span className="size-8 shrink-0 rounded-full bg-raised" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{account.name}</span>
                    <span className="block truncate text-xs text-faint">@{account.username}</span>
                  </span>
                </div>
              ) : null}

              {menu.map((entry) => (
                <button
                  key={entry.modal}
                  type="button"
                  onClick={() => {
                    store.setModal(entry.modal)
                    setMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-[13px] text-dim transition-colors hover:bg-raised hover:text-text"
                >
                  <Icon name={entry.icon} className="size-4" />
                  {store.t(entry.label)}
                </button>
              ))}

              {account ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    setLeaving(true)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-[13px] text-danger transition-colors hover:bg-danger/10"
                >
                  <Icon name="external" className="size-4" />
                  {store.t('menu.leave')}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      <Confirm
        open={leaving}
        title={store.t('menu.leave')}
        body={store.t('menu.leaveBody')}
        confirmLabel={store.t('menu.leave')}
        cancelLabel={store.t('common.cancel')}
        onCancel={() => setLeaving(false)}
        onConfirm={async () => {
          setLeaving(false)
          if (!account) return

          try {
            await accountsApi.remove(account.id)
            await store.refreshAccounts()
          } catch (error) {
            store.toast(error instanceof Error ? error.message : String(error), 'danger')
          }
        }}
      />
    </nav>
  )
}

function CommandPalette() {
  const open = useStore((state) => state.paletteOpen)
  return open ? <Palette /> : null
}

type Command = { id: string; label: string; hint?: string; icon: string; run: () => void }

function Palette() {
  const store = useStore()
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const pages: Command[] = navigation.map((entry) => ({
      id: entry.view,
      icon: entry.icon,
      label: store.t(entry.label),
      run: () => store.setView(entry.view),
    }))

    const actions: Command[] = [
      {
        id: 'newChat',
        icon: 'plus',
        label: store.t('build.newChat'),
        hint: 'Ctrl N',
        run: () => {
          store.setView('build')
          window.dispatchEvent(new CustomEvent('jstudio:newChat'))
        },
      },
      {
        id: 'model',
        icon: 'spark',
        label: store.t('settings.model'),
        hint: 'Ctrl I',
        run: () => {
          store.setView('build')
          window.dispatchEvent(new CustomEvent('jstudio:pickModel'))
        },
      },
      { id: 'accounts', icon: 'user', label: store.t('menu.accounts'), run: () => store.setModal('accounts') },
      {
        id: 'settings',
        icon: 'settings',
        hint: 'Ctrl ,',
        label: store.t('menu.settings'),
        run: () => store.setModal('settings'),
      },
      {
        id: 'sidebar',
        icon: 'sidebar',
        hint: 'Ctrl B',
        label: store.t('header.sidebar'),
        run: () => store.setRail(!store.railOpen),
      },
      {
        id: 'plugin',
        icon: 'plugin',
        label: `${store.t('home.install')} · ${store.t('home.plugin')}`,
        run: async () => {
          await pluginApi.install()
          await store.refreshStatus()
          store.toast(store.t('settings.pluginInstalled'), 'ok')
        },
      },
      {
        id: 'theme',
        icon: 'spark',
        label: store.t('settings.theme'),
        run: () => void store.patchSettings({ theme: store.settings.theme === 'dark' ? 'light' : 'dark' }),
      },
      {
        id: 'mode',
        icon: 'plan',
        hint: 'Ctrl M',
        label: `${store.t('settings.mode')} · ${store.t(modeLabels[store.settings.mode])}`,
        run: () => {
          const modes = ['manual', 'auto', 'plan'] as const
          const next = modes[(modes.indexOf(store.settings.mode) + 1) % modes.length] ?? 'manual'
          void store.patchSettings({ mode: next })
        },
      },
      {
        id: 'effort',
        icon: 'chart',
        hint: 'Ctrl E',
        label: `${store.t('settings.effort')} · ${store.t(effortLabels[store.settings.effort])}`,
        run: () => {
          const efforts = ['low', 'medium', 'high'] as const
          const next = efforts[(efforts.indexOf(store.settings.effort) + 1) % efforts.length] ?? 'medium'
          void store.patchSettings({ effort: next })
        },
      },
    ]

    const chats: Command[] = store.conversations.slice(0, 30).map((conversation) => ({
      id: conversation.id,
      icon: 'build',
      label: conversation.title,
      run: () => {
        store.setView('build')
        window.dispatchEvent(new CustomEvent('jstudio:openChat', { detail: conversation }))
      },
    }))

    return [
      { label: store.t('palette.pages'), items: pages },
      { label: store.t('palette.actions'), items: actions },
      { label: store.t('palette.chats'), items: chats },
    ]
  }, [store])

  const needle = query.trim().toLowerCase()
  const filtered = groups
    .map((group) => ({
      label: group.label,
      items: group.items.filter((item) => item.label.toLowerCase().includes(needle)),
    }))
    .filter((group) => group.items.length > 0)

  const first = filtered[0]?.items[0]

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-6 pt-[14vh]"
      onClick={() => store.setPalette(false)}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="riseIn w-full max-w-xl overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon name="search" className="text-faint" />
          <input
            autoFocus
            value={query}
            placeholder={store.t('header.search')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && first) {
                void first.run()
                store.setPalette(false)
              }
              if (event.key === 'Escape') store.setPalette(false)
            }}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>

        <div className="max-h-96 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-faint">{store.t('command.empty')}</p>
          ) : (
            filtered.map((group) => (
              <div key={group.label}>
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-faint">
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      void item.run()
                      store.setPalette(false)
                    }}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-sm text-dim transition-colors hover:bg-raised hover:text-text"
                  >
                    <Icon name={item.icon} className="size-4 shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint ? (
                      <span className="shrink-0 font-mono text-[10px] text-faint">{item.hint}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function Toasts() {
  const { toasts, dismissToast } = useStore()

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-30 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismissToast(toast.id)}
          className={cx(
            'toastIn pointer-events-auto flex items-start gap-2.5 overflow-hidden rounded-[var(--radius-panel)] border bg-surface px-3.5 py-2.5 text-left text-[13px] transition-transform hover:-translate-x-0.5',
            toast.tone === 'danger' ? 'border-danger/40 text-danger' : 'border-line text-text'
          )}
        >
          <Icon
            name={toast.tone === 'danger' ? 'alert' : toast.tone === 'ok' ? 'check' : 'spark'}
            className={cx('mt-0.5 size-4 shrink-0', toast.tone === 'ok' && 'text-ok')}
          />
          <span className="min-w-0 flex-1">{toast.text}</span>
          <Icon name="close" className="mt-0.5 size-3.5 shrink-0 text-faint" />
        </button>
      ))}
    </div>
  )
}

function StillNeeded({ need }: { need: 'build' | 'animations' | 'cloud' }) {
  const store = useStore()
  const { t } = store

  const copy = {
    build: { icon: 'spark', title: 'gate.buildTitle', body: 'gate.buildBody', action: 'gate.buildAction' },
    animations: {
      icon: 'user',
      title: 'gate.animationsTitle',
      body: 'gate.animationsBody',
      action: 'gate.animationsAction',
    },
    cloud: { icon: 'key', title: 'gate.cloudTitle', body: 'gate.cloudBody', action: 'gate.cloudAction' },
  }[need] as { icon: string; title: MessageKey; body: MessageKey; action: MessageKey }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft">
          <Icon name={copy.icon} className="size-5 text-accent" />
        </span>
        <h2 className="text-sm font-semibold">{t(copy.title)}</h2>
        <p className="text-[13px] text-dim">{t(copy.body)}</p>
        <Button tone="primary" onClick={() => store.setModal(need === 'build' ? 'settings' : 'accounts')}>
          {t(copy.action)}
        </Button>
      </div>
    </div>
  )
}
