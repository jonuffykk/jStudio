'use client'

import { useState, type ReactNode } from 'react'
import { accounts as accountsApi, openExternal } from '@/app/lib/ipc'
import { listModels, resolveEndpoint } from '@/app/lib/llm'
import { findProvider, pickDefaultModel, providers } from '@/app/lib/providers'
import { useStore } from '@/app/lib/state'
import { Badge, Button, Field, Icon, IconButton, Input, Select, Spinner, cx } from '@/app/ui/primitives'
import type { MessageKey } from '@/app/lib/i18n'

const CREDENTIALS_URL = 'https://create.roblox.com/dashboard/credentials'

export function OnboardingView() {
  const store = useStore()
  const { settings, apiKey, t } = store

  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [useCookie, setUseCookie] = useState(false)
  const [cookie, setCookie] = useState('')
  const [opened, setOpened] = useState<string | null>(null)

  const provider = findProvider(settings.providerId)
  const account = store.activeAccount()
  const wants = settings.intent

  const chose = wants.length > 0
  const aiDone = store.aiReady()
  const robloxDone = store.robloxReady()
  const cloudDone = store.cloudReady()

  const toggleIntent = (intent: 'build' | 'animations') => {
    const next = wants.includes(intent) ? wants.filter((entry) => entry !== intent) : [...wants, intent]
    void store.patchSettings({ intent: next })
  }

  // The first step that is not finished yet, so the person always lands on the
  // one thing left to do instead of a wall of open panels.
  const current = !chose
    ? 'intent'
    : wants.includes('build') && !aiDone
      ? 'provider'
      : wants.includes('animations') && !robloxDone
        ? 'roblox'
        : wants.includes('animations') && !cloudDone
          ? 'cloud'
          : 'done'

  const refreshModels = async () => {
    setLoadingModels(true)
    try {
      const list = await listModels(
        resolveEndpoint({
          providerId: settings.providerId,
          customBaseUrl: settings.customBaseUrl,
          apiKey,
          model: settings.model,
          temperature: settings.temperature,
        })
      )
      setModels(list)
      if (!list.includes(settings.model)) await store.patchSettings({ model: pickDefaultModel(list) })
    } catch (error) {
      store.toast(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setLoadingModels(false)
    }
  }

  const capture = async (run: () => Promise<{ accounts: unknown; activeId: string | null }>) => {
    try {
      await run()
      await store.refreshAccounts()
    } catch (error) {
      store.toast(error instanceof Error ? error.message : String(error), 'danger')
    }
  }

  const pending = store.blockers()
  let index = 0

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-lg flex-col gap-3 px-6 py-10">
        <header className="text-center">
          <img src="/logo.png" alt="" width={52} height={52} className="mx-auto rounded-xl" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">{t('onboard.title')}</h1>
          <p className="mt-1 text-[13px] text-dim">{t('onboard.subtitle')}</p>
        </header>

        <Step
          id="intent"
          index={(index += 1)}
          title={t('onboard.intent')}
          body={t('onboard.intentBody')}
          done={chose}
          current={current}
          opened={opened}
          setOpened={setOpened}
        >
          <div className="grid gap-2">
            <Choice
              icon="spark"
              title={t('onboard.intentBuild')}
              body={t('onboard.intentBuildBody')}
              picked={wants.includes('build')}
              onClick={() => toggleIntent('build')}
            />
            <Choice
              icon="play"
              title={t('onboard.intentAnimations')}
              body={t('onboard.intentAnimationsBody')}
              picked={wants.includes('animations')}
              onClick={() => toggleIntent('animations')}
            />
          </div>
          <p className="text-xs text-faint">{t('onboard.intentBoth')}</p>
        </Step>

        {wants.includes('build') ? (
          <Step
            id="provider"
            index={(index += 1)}
            title={t('onboard.provider')}
            body={t('onboard.providerBody')}
            done={aiDone}
            current={current}
            opened={opened}
            setOpened={setOpened}
          >
            <Field label={t('settings.provider')} hint={provider.hint}>
              <Select
                value={settings.providerId}
                onChange={(value) => void store.patchSettings({ providerId: value })}
                options={providers.map((entry) => ({ value: entry.id, label: entry.label }))}
              />
            </Field>

            {settings.providerId === 'custom' ? (
              <Field label={t('settings.baseUrl')}>
                <Input
                  value={settings.customBaseUrl}
                  onChange={(value) => void store.patchSettings({ customBaseUrl: value })}
                  placeholder="https://host/v1"
                  mono
                />
              </Field>
            ) : null}

            {provider.needsKey ? (
              <Field label={t('settings.apiKey')} hint={t('onboard.keyHint')}>
                <div className="flex gap-2">
                  <Input type="password" value={apiKey} onChange={(value) => void store.setApiKey(value)} mono />
                  {provider.keyUrl ? (
                    <IconButton
                      icon="external"
                      title={t('accounts.getApiKey')}
                      onClick={() => void openExternal(provider.keyUrl)}
                    />
                  ) : null}
                </div>
              </Field>
            ) : null}

            <Field label={t('settings.model')}>
              <div className="flex gap-2">
                {models.length > 0 ? (
                  <Select
                    value={settings.model}
                    onChange={(value) => void store.patchSettings({ model: value })}
                    options={models.map((model) => ({ value: model, label: model }))}
                  />
                ) : (
                  <Input
                    value={settings.model}
                    onChange={(value) => void store.patchSettings({ model: value })}
                    mono
                  />
                )}

                {loadingModels ? (
                  <span className="flex size-8 items-center justify-center">
                    <Spinner />
                  </span>
                ) : (
                  <IconButton icon="refresh" title={t('settings.refresh')} onClick={() => void refreshModels()} />
                )}
              </div>
            </Field>
          </Step>
        ) : null}

        {wants.includes('animations') ? (
          <Step
            id="roblox"
            index={(index += 1)}
            title={t('onboard.roblox')}
            body={t('onboard.robloxBody')}
            done={robloxDone}
            current={current}
            opened={opened}
            setOpened={setOpened}
          >
            {account ? (
              <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-bg px-3 py-2.5">
                {account.avatarUrl ? (
                  <img src={account.avatarUrl} alt="" className="size-9 rounded-full" />
                ) : (
                  <span className="size-9 rounded-full bg-raised" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{account.name}</p>
                  <p className="truncate text-xs text-faint">@{account.username}</p>
                </div>
                <Button size="sm" tone="ghost" onClick={() => void capture(() => accountsApi.remove(account.id))}>
                  {t('accounts.remove')}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {signingIn ? (
                  <div className="flex flex-col items-center gap-3 rounded-[var(--radius-control)] border border-line bg-bg py-8 text-center">
                    <Spinner className="size-5" />
                    <p className="text-sm font-medium">{t('accounts.signingIn')}</p>
                    <p className="max-w-xs text-[13px] text-dim">{t('accounts.signingInBody')}</p>
                  </div>
                ) : (
                  <Button
                    tone="primary"
                    full
                    icon="user"
                    onClick={async () => {
                      setSigningIn(true)
                      await capture(accountsApi.signIn)
                      setSigningIn(false)
                    }}
                  >
                    {t('accounts.signIn')}
                  </Button>
                )}

                <button
                  type="button"
                  onClick={() => setUseCookie(!useCookie)}
                  className="flex w-full items-center gap-1.5 text-[13px] text-faint transition-colors hover:text-text"
                >
                  <Icon name="chevron" className={cx('size-3.5 transition-transform', useCookie && 'rotate-90')} />
                  {t('accounts.advanced')}
                </button>

                {useCookie ? (
                  <div className="flex gap-2">
                    <Input type="password" value={cookie} onChange={setCookie} mono />
                    <Button
                      size="sm"
                      disabled={!cookie.trim()}
                      onClick={async () => {
                        await capture(() => accountsApi.signInWithCookie(cookie.trim()))
                        setCookie('')
                      }}
                    >
                      {t('common.save')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </Step>
        ) : null}

        {wants.includes('animations') ? (
          <Step
            id="cloud"
            index={(index += 1)}
            title={t('onboard.cloudKey')}
            body={t('onboard.cloudKeyBody')}
            done={cloudDone}
            current={current}
            opened={opened}
            setOpened={setOpened}
          >
            {account ? (
              <CloudKeyGuide accountId={account.id} done={cloudDone} />
            ) : (
              <p className="text-[13px] text-dim">{t('onboard.cloudNeedsAccount')}</p>
            )}
          </Step>
        ) : null}

        <div className="pt-1">
          <Button
            tone="primary"
            full
            disabled={!chose}
            onClick={() => {
              void store.patchSettings({ onboarded: true })
              store.setView('home')
            }}
          >
            {pending.length > 0 ? t('onboard.enterAnyway') : t('onboard.enter')}
          </Button>
          <p className="mt-2 text-center text-xs text-faint">
            {!chose ? t('onboard.pickOne') : pending.length > 0 ? t('onboard.later') : t('onboard.allSet')}
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Roblox has no API that mints an Open Cloud key, so this cannot be done for the
 * person. What it can do is name every field to fill, hand over the values to
 * paste, and check the finished key before they walk away believing it works.
 */
export function CloudKeyGuide({
  accountId,
  done,
  onSaved,
}: {
  accountId: string
  done: boolean
  onSaved?: () => void
}) {
  const store = useStore()
  const { t } = store

  const [key, setKey] = useState('')
  const [checking, setChecking] = useState(false)
  const [verdict, setVerdict] = useState<MessageKey | null>(null)

  const save = async () => {
    const trimmed = key.trim()
    if (!trimmed) return

    setChecking(true)
    setVerdict(null)

    try {
      const { verdict: result } = await accountsApi.probeApiKey(trimmed)

      if (result === 'unauthorized' || result === 'forbidden') {
        setVerdict(result === 'unauthorized' ? 'cloud.unauthorized' : 'cloud.forbidden')
        return
      }

      await accountsApi.setApiKey(accountId, trimmed)
      await store.refreshAccounts()
      setKey('')
      setVerdict(result === 'ok' ? 'cloud.ok' : 'cloud.unchecked')
      onSaved?.()
    } catch (error) {
      store.toast(error instanceof Error ? error.message : String(error), 'danger')
    } finally {
      setChecking(false)
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-ok/40 bg-bg px-3 py-2.5 text-[13px]">
        <Icon name="check" className="size-4 text-ok" />
        <span className="flex-1">{t('cloud.saved')}</span>
        <Button size="sm" tone="ghost" onClick={() => void accountsApi.setApiKey(accountId, '').then(store.refreshAccounts)}>
          {t('cloud.replace')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Button tone="primary" full icon="external" onClick={() => void openExternal(CREDENTIALS_URL)}>
        {t('cloud.open')}
      </Button>

      <ol className="space-y-2.5">
        <Line n={1} text={t('cloud.step1')} />
        <Line n={2} text={t('cloud.step2')} copy="jStudio" />
        <Line n={3} text={t('cloud.step3')} copy="Assets" />
        <Line n={4} text={t('cloud.step4')} />
        <Line n={5} text={t('cloud.step5')} copy="0.0.0.0/0" />
        <Line n={6} text={t('cloud.step6')} />
      </ol>

      <Field label={t('cloud.paste')}>
        <div className="flex gap-2">
          <Input type="password" value={key} onChange={setKey} placeholder="•••••" mono />
          {checking ? (
            <span className="flex size-8 items-center justify-center">
              <Spinner />
            </span>
          ) : (
            <IconButton icon="check" title={t('cloud.check')} disabled={!key.trim()} onClick={() => void save()} />
          )}
        </div>
      </Field>

      {verdict ? (
        <p
          className={cx(
            'text-[13px]',
            verdict === 'cloud.ok' ? 'text-ok' : verdict === 'cloud.unchecked' ? 'text-dim' : 'text-danger'
          )}
        >
          {t(verdict)}
        </p>
      ) : null}
    </div>
  )
}

function Line({ n, text, copy }: { n: number; text: string; copy?: string }) {
  const t = useStore((state) => state.t)
  const [copied, setCopied] = useState(false)

  return (
    <li className="flex gap-2.5 text-[13px] leading-relaxed">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-dim">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-dim">{text}</span>
      {copy ? (
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(copy)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          title={t('cloud.copy')}
          className="flex h-6 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-bg px-2 font-mono text-[11px] text-text transition-colors hover:border-focus"
        >
          {copy}
          <Icon name={copied ? 'check' : 'copy'} className={cx('size-3', copied && 'text-ok')} />
        </button>
      ) : null}
    </li>
  )
}

function Choice({
  icon,
  title,
  body,
  picked,
  onClick,
}: {
  icon: string
  title: string
  body: string
  picked: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={picked}
      className={cx(
        'flex items-start gap-3 rounded-[var(--radius-control)] border bg-bg p-3 text-left transition-colors',
        picked ? 'border-accent/60' : 'border-line hover:border-focus'
      )}
    >
      <span
        className={cx(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          picked ? 'bg-accent-soft text-accent' : 'bg-raised text-dim'
        )}
      >
        <Icon name={icon} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-faint">{body}</span>
      </span>
      {picked ? <Icon name="check" className="size-4 shrink-0 text-accent" /> : null}
    </button>
  )
}

function Step({
  id,
  index,
  title,
  body,
  done,
  current,
  opened,
  setOpened,
  children,
}: {
  id: string
  index: number
  title: string
  body: string
  done: boolean
  current: string
  opened: string | null
  setOpened: (id: string | null) => void
  children: ReactNode
}) {
  const t = useStore((state) => state.t)
  const open = opened === null ? current === id : opened === id

  return (
    <section
      className={cx(
        'overflow-hidden rounded-[var(--radius-panel)] border bg-surface transition-colors',
        done ? 'border-ok/40' : open ? 'border-line' : 'border-line/60'
      )}
    >
      <button
        type="button"
        onClick={() => setOpened(open ? '' : id)}
        className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-raised/40"
      >
        <span
          className={cx(
            'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
            done ? 'bg-ok/15 text-ok' : 'bg-accent-soft text-accent'
          )}
        >
          {done ? <Icon name="check" className="size-4" /> : index}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-faint">{body}</p>
        </div>
        {done ? <Badge tone="ok">{t('onboard.done')}</Badge> : null}
        <Icon name="chevron" className={cx('size-4 text-faint transition-transform', open && 'rotate-90')} />
      </button>

      {open ? <div className="space-y-3 p-4">{children}</div> : null}
    </section>
  )
}
