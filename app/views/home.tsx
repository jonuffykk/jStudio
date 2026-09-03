'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { plugin as pluginApi } from '@/app/lib/ipc'
import { findProvider } from '@/app/lib/providers'
import { installUpdate, play } from '@/app/lib/host'
import { useStore } from '@/app/lib/state'
import { Button, Icon, Panel, Skeleton, Spinner, cx } from '@/app/ui/primitives'

const when = (value: number) => new Date(value).toLocaleString()
const clock = (value: number) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const compact = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value))

export function HomeView() {
  const store = useStore()
  const { status, plugin, settings, nodes, conversations, runs, t } = store
  const account = store.activeAccount()
  const scripts = nodes.filter((node) => node.source !== undefined).length

  const [installing, setInstalling] = useState(false)
  const autoInstalled = useRef(false)

  const install = async (announce: boolean) => {
    setInstalling(true)
    try {
      await pluginApi.install()
      await store.refreshStatus()
      if (announce) store.toast(t('settings.pluginInstalled'), 'ok')
    } catch (error) {
      if (announce) store.toast(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setInstalling(false)
    }
  }

  useEffect(() => {
    if (!store.ready || autoInstalled.current) return
    if (plugin.installed && !plugin.outdated) return

    autoInstalled.current = true
    void Promise.resolve().then(() => install(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ready, plugin.installed, plugin.outdated])

  const effortLabel =
    settings.effort === 'low'
      ? t('settings.effortLow')
      : settings.effort === 'high'
        ? t('settings.effortHigh')
        : t('settings.effortMedium')

  const openChat = (id?: string) => {
    const conversation = conversations.find((entry) => entry.id === id)
    window.dispatchEvent(
      conversation
        ? new CustomEvent('jstudio:openChat', { detail: conversation })
        : new CustomEvent('jstudio:newChat')
    )
    store.setView('build')
  }

  const days = settings.usageLog.slice(0, 7)
  const today = days[0]
  const peak = Math.max(1, ...days.map((entry) => entry.input + entry.output))

  const windows = [
    { label: t('home.last6'), hours: 6 },
    { label: t('home.last24'), hours: 24 },
  ].map((entry) => ({
    label: entry.label,
    tokens: settings.usagePulse
      .filter((pulse) => pulse.at >= Date.now() - entry.hours * 3_600_000)
      .reduce((sum, pulse) => sum + pulse.input + pulse.output, 0),
  }))

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-line px-5">
        <h1 className="text-sm font-semibold">{t('nav.home')}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {t('home.hi', { name: account?.name ?? 'there' })}
            </h2>
            <p className="mt-1 text-[13px] text-dim">{t('home.subtitle')}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <ActionCard
              icon="build"
              title={t('home.newChat')}
              body={t('home.cardBuild')}
              onClick={() => openChat()}
            />
            <ActionCard
              icon="film"
              title={t('home.runAnimations')}
              body={t('home.cardAnimations')}
              onClick={() => store.setView('assets')}
            />
            <ActionCard
              icon="settings"
              title={t('menu.settings')}
              body={`${settings.model || t('build.model')} · ${effortLabel}`}
              onClick={() => store.setModal('settings')}
            />
          </div>

          <div className="grid items-stretch gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Panel title={t('home.system')}>
                <ul className="divide-y divide-line">
                  <Row
                    icon="home"
                    tone={status.online ? 'ok' : 'neutral'}
                    label={t('home.studio')}
                    value={
                      status.online
                        ? (status.placeName?.trim() || t('status.connected'))
                        : t('status.disconnected')
                    }
                    detail={
                      !status.online
                        ? t('home.noStudio')
                        : status.nodeCount === 0
                          ? t('home.syncing')
                          : `${status.nodeCount} ${t('status.instances')} · ${scripts} ${t('status.scripts')}`
                    }
                  />

                  <Row
                    icon="user"
                    tone={
                      account?.hasApiKey ? 'ok' : settings.intent.includes('animations') ? 'warn' : 'neutral'
                    }
                    label={t('home.account')}
                    value={account?.name ?? t('status.noAccount')}
                    detail={account ? `@${account.username}` : ''}
                    action={
                      <Button size="sm" onClick={() => store.setModal('accounts')}>
                        {t('common.open')}
                      </Button>
                    }
                  />

                  <Row
                    icon="spark"
                    tone="accent"
                    label={t('home.model')}
                    value={settings.model || '—'}
                    detail={`${findProvider(settings.providerId).label} · ${effortLabel}`}
                    action={
                      <Button size="sm" onClick={() => store.setModal('settings')}>
                        {t('common.open')}
                      </Button>
                    }
                  />
                </ul>
              </Panel>
            </div>

            <div>
              <Panel title={t('home.usage')}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
                  {t('home.tokensToday')}
                </p>
                <p className="text-2xl font-semibold tracking-tight">
                  {compact((today?.input ?? 0) + (today?.output ?? 0))}
                </p>
                <p className="text-xs text-dim">
                  {today?.runs ?? 0} {t('home.requests')}
                </p>

                <div className="mt-3 flex h-16 items-end gap-1">
                  {days.length === 0 ? (
                    <p className="text-[13px] text-faint">{t('home.empty')}</p>
                  ) : (
                    [...days].reverse().map((entry) => (
                      <span
                        key={entry.day}
                        title={`${entry.day} · ${(entry.input + entry.output).toLocaleString()}`}
                        className="min-h-1 flex-1 rounded-t bg-accent/40 transition-colors hover:bg-accent"
                        style={{ height: `${((entry.input + entry.output) / peak) * 100}%` }}
                      />
                    ))
                  )}
                </div>

                <ul className="mt-auto divide-y divide-line border-t border-line pt-1">
                  {windows.map((window) => (
                    <li key={window.label} className="flex items-center justify-between gap-4 py-1.5">
                      <span className="text-[13px] text-dim">{window.label}</span>
                      <span className="font-mono text-xs text-faint">{compact(window.tokens)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            <Panel title={t('home.recentChats')}>
              {!store.ready ? (
                <Loading />
              ) : conversations.length === 0 ? (
                <p className="min-h-[86px] text-[13px] text-faint">{t('home.empty')}</p>
              ) : (
                <ul className="min-h-[86px] space-y-0.5">
                  {conversations.slice(0, 3).map((conversation) => (
                    <li key={conversation.id}>
                      <button
                        type="button"
                        onClick={() => openChat(conversation.id)}
                        className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[13px] text-dim transition-colors hover:bg-raised hover:text-text"
                      >
                        <Icon name="build" className="size-3.5 shrink-0 text-faint" />
                        <span className="truncate">{conversation.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t('home.recentRuns')}>
              {!store.ready ? (
                <Loading />
              ) : runs.length === 0 ? (
                <p className="min-h-[86px] text-[13px] text-faint">{t('home.empty')}</p>
              ) : (
                <ul className="min-h-[86px] space-y-0.5">
                  {runs.slice(0, 3).map((run) => (
                    <li key={run.id}>
                      <button
                        type="button"
                        onClick={() => store.openRun(run.id)}
                        className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-raised"
                      >
                        <Icon
                          name={run.failed > 0 ? 'alert' : 'check'}
                          className={cx('size-3.5 shrink-0', run.failed > 0 ? 'text-warn' : 'text-ok')}
                        />
                        <span className="min-w-0 flex-1 truncate text-dim">
                          {run.label || t('spoof.runReplaced', { count: run.done })}
                        </span>
                        <span className="shrink-0 text-[11px] text-faint" title={when(run.startedAt)}>
                          {clock(run.startedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t('home.updates')}>
              <ul className="divide-y divide-line">
                <Row
                  icon="refresh"
                  tone={store.updateVersion ? 'accent' : 'ok'}
                  label={t('home.app')}
                  value={
                    store.updateVersion
                      ? t('home.updateAvailable', { version: store.updateVersion })
                      : t('home.upToDate')
                  }
                  detail={`${t('home.version')} ${plugin.bundledVersion}`}
                  action={
                    store.updateVersion ? (
                      <Button size="sm" tone="primary" onClick={() => void installUpdate()}>
                        {t('home.installUpdate')}
                      </Button>
                    ) : null
                  }
                />

                <Row
                  icon="grid"
                  tone={plugin.installed && !plugin.outdated ? 'ok' : 'warn'}
                  label={t('home.plugin')}
                  value={
                    installing
                      ? t('home.pluginInstalling')
                      : plugin.installed
                        ? plugin.outdated
                          ? t('home.pluginOutdated')
                          : t('home.pluginReady')
                        : t('home.pluginMissing')
                  }
                  detail={
                    plugin.runningVersion
                      ? `${plugin.runningVersion} → ${plugin.bundledVersion}`
                      : `${t('home.version')} ${plugin.bundledVersion}`
                  }
                  action={
                    <Button
                      size="sm"
                      tone={plugin.installed && !plugin.outdated ? 'neutral' : 'primary'}
                      disabled={installing}
                      onClick={() => void install(true)}
                    >
                      {installing ? <Spinner /> : plugin.installed ? t('home.reinstall') : t('home.install')}
                    </Button>
                  }
                />
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="space-y-1.5">
      <Skeleton className="h-6" />
      <Skeleton className="h-6" />
      <Skeleton className="h-6" />
    </div>
  )
}

function ActionCard({
  icon,
  title,
  body,
  onClick,
}: {
  icon: string
  title: string
  body: string
  onClick: () => void
}) {
  const sounds = useStore((state) => state.settings.sounds)

  return (
    <button
      type="button"
      onClick={() => {
        play('tap', sounds)
        onClick()
      }}
      className="group flex items-start gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 text-left transition-colors hover:border-focus hover:bg-raised"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-white">
        <Icon name={icon} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-dim">{body}</span>
      </span>
    </button>
  )
}

function Row({
  icon,
  tone,
  label,
  value,
  detail,
  action,
}: {
  icon: string
  tone: 'ok' | 'warn' | 'neutral' | 'accent'
  label: string
  value: string
  detail: string
  action?: ReactNode
}) {
  const tones = {
    ok: 'text-ok',
    warn: 'text-warn',
    neutral: 'text-faint',
    accent: 'text-accent',
  }

  return (
    <li className="group flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-raised transition-colors group-hover:bg-accent-soft">
        <Icon name={icon} className={cx('size-4', tones[tone])} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
        <p className="truncate text-sm">{value}</p>
        {detail ? <p className="truncate text-xs text-dim">{detail}</p> : null}
      </div>

      {action}
    </li>
  )
}
