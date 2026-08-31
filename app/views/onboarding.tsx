'use client'

import { useState, type ReactNode } from 'react'
import { accounts as accountsApi, openExternal } from '@/app/lib/ipc'
import { listModels, resolveEndpoint } from '@/app/lib/llm'
import { findProvider, pickDefaultModel, providers } from '@/app/lib/providers'
import { useStore } from '@/app/lib/state'
import { Badge, Button, Field, Icon, IconButton, Input, Select, Spinner, cx } from '@/app/ui/primitives'

export function OnboardingView() {
  const store = useStore()
  const { settings, apiKey, t } = store

  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [useCookie, setUseCookie] = useState(false)
  const [cookie, setCookie] = useState('')
  const [cloudKey, setCloudKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)

  const provider = findProvider(settings.providerId)
  const account = store.activeAccount()
  const blockers = store.blockers()

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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-lg flex-col gap-4 px-6 py-10">
        <header className="text-center">
          <img src="/logo.png" alt="" width={52} height={52} className="mx-auto rounded-xl" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">{t('onboard.title')}</h1>
          <p className="mt-1 text-[13px] text-dim">{t('onboard.subtitle')}</p>
        </header>

        <Step
          index={1}
          title={t('onboard.provider')}
          body={t('onboard.providerBody')}
          done={(!provider.needsKey || !!apiKey) && !!settings.model}
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
            <Field label={t('settings.apiKey')}>
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

        <Step
          index={2}
          title={t('onboard.roblox')}
          body={t('onboard.robloxBody')}
          done={!!account?.hasApiKey}
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

          {account && !account.hasApiKey ? (
            <Field label={t('onboard.cloudKey')} hint={t('onboard.cloudKeyBody')}>
              <div className="flex gap-2">
                <Input type="password" value={cloudKey} onChange={setCloudKey} placeholder="•••••" mono />
                <IconButton
                  icon="external"
                  title={t('accounts.getApiKey')}
                  onClick={() => void openExternal('https://create.roblox.com/dashboard/credentials')}
                />
                {savingKey ? (
                  <span className="flex size-8 items-center justify-center">
                    <Spinner />
                  </span>
                ) : (
                  <IconButton
                    icon="check"
                    title={t('common.save')}
                    disabled={!cloudKey.trim()}
                    onClick={async () => {
                      setSavingKey(true)
                      await capture(() => accountsApi.setApiKey(account.id, cloudKey.trim()))
                      setCloudKey('')
                      setSavingKey(false)
                    }}
                  />
                )}
              </div>
            </Field>
          ) : null}
        </Step>

        <div className="pt-1">
          <Button tone="primary" full disabled={blockers.length > 0} onClick={() => store.setView('home')}>
            {t('onboard.enter')}
          </Button>
          {blockers.length > 0 ? (
            <p className="mt-2 text-center text-xs text-faint">{t('onboard.missing')}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Step({
  index,
  title,
  body,
  done,
  children,
}: {
  index: number
  title: string
  body: string
  done: boolean
  children: ReactNode
}) {
  const t = useStore((state) => state.t)

  return (
    <section
      className={cx(
        'overflow-hidden rounded-[var(--radius-panel)] border bg-surface transition-colors',
        done ? 'border-ok/40' : 'border-line'
      )}
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
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
      </header>

      <div className="space-y-3 p-4">{children}</div>
    </section>
  )
}
