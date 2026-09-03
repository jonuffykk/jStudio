'use client'

import { useState } from 'react'
import { accounts as accountsApi, type Account } from '@/app/lib/ipc'
import { useStore } from '@/app/lib/state'
import { CloudKeyGuide } from '@/app/views/onboarding'
import {
  Badge,
  Button,
  Confirm,
  Field,
  Icon,
  IconButton,
  Input,
  Modal,
  Spinner,
  cx,
} from '@/app/ui/primitives'

type Stage = 'list' | 'add' | 'key'

export function AccountsModal() {
  const store = useStore()
  const { accounts, activeAccountId, t } = store

  const [stage, setStage] = useState<Stage>(accounts.length === 0 ? 'add' : 'list')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [cookie, setCookie] = useState('')
  const [useCookie, setUseCookie] = useState(false)
  const [working, setWorking] = useState(false)

  const run = async (task: () => Promise<unknown>) => {
    setWorking(true)
    try {
      await task()
      await store.refreshAccounts()
      return true
    } catch (error) {
      store.toast(error instanceof Error ? error.message : String(error), 'danger')
      return false
    } finally {
      setWorking(false)
    }
  }

  const afterSignIn = () => {
    const { accounts: list, activeAccountId: id } = useStore.getState()
    setPending(id)
    setStage(list.find((entry) => entry.id === id)?.hasApiKey ? 'list' : 'key')
  }

  const back = () => {
    setStage('list')
    setPending(null)
    setUseCookie(false)
    setCookie('')
  }

  return (
    <Modal open onClose={() => store.setModal('none')} title={t('accounts.title')}>
      {stage === 'list' ? (
        <div className="space-y-3">
          {accounts.length === 0 ? (
            <p className="rounded-[var(--radius-control)] border border-line bg-bg px-3 py-6 text-center text-[13px] text-faint">
              {t('accounts.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  active={account.id === activeAccountId}
                  open={expanded === account.id}
                  busy={working}
                  onUse={() => void run(() => accountsApi.setActive(account.id))}
                  onToggleKey={() => setExpanded(expanded === account.id ? null : account.id)}
                  onRemove={() => setRemoving(account.id)}
                />
              ))}
            </ul>
          )}

          <Button full icon="plus" onClick={() => setStage('add')}>
            {t('accounts.addAnother')}
          </Button>

          <Confirm
            open={removing !== null}
            title={t('accounts.remove')}
            body={t('menu.leaveBody')}
            confirmLabel={t('accounts.remove')}
            cancelLabel={t('common.cancel')}
            onCancel={() => setRemoving(null)}
            onConfirm={async () => {
              const id = removing
              setRemoving(null)
              if (!id) return

              await run(() => accountsApi.remove(id))
              setExpanded(null)
              if (useStore.getState().accounts.length === 0) setStage('add')
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.length > 0 ? (
            <button
              type="button"
              disabled={working}
              onClick={back}
              className="flex items-center gap-1.5 text-[13px] text-faint transition-colors hover:text-text disabled:opacity-40"
            >
              <Icon name="chevron" className="size-3.5 rotate-180" />
              {t('accounts.back')}
            </button>
          ) : null}

          {stage === 'add' ? (
            <Section index={1} title={t('accounts.step')} body={t('onboard.robloxBody')}>
              {working ? (
                <div className="flex flex-col items-center gap-3 rounded-[var(--radius-control)] border border-line bg-bg py-8 text-center">
                  <Spinner className="size-5" />
                  <p className="text-sm font-medium">{t('accounts.signingIn')}</p>
                  <p className="max-w-xs text-[13px] text-dim">{t('accounts.signingInBody')}</p>
                </div>
              ) : (
                <>
                  <Button
                    tone="primary"
                    full
                    icon="user"
                    onClick={async () => {
                      if (await run(accountsApi.signIn)) afterSignIn()
                    }}
                  >
                    {t('accounts.signIn')}
                  </Button>

                  <button
                    type="button"
                    onClick={() => setUseCookie(!useCookie)}
                    className="flex w-full items-center gap-1.5 text-[13px] text-faint transition-colors hover:text-text"
                  >
                    <Icon
                      name="chevron"
                      className={cx('size-3.5 transition-transform', useCookie && 'rotate-90')}
                    />
                    {t('accounts.advanced')}
                  </button>

                  {useCookie ? (
                    <Field label={t('accounts.cookie')} hint={t('onboard.keyHint')}>
                      <div className="flex gap-2">
                        <Input type="password" value={cookie} onChange={setCookie} mono />
                        <Button
                          size="sm"
                          disabled={!cookie.trim()}
                          onClick={async () => {
                            if (await run(() => accountsApi.signInWithCookie(cookie.trim()))) {
                              setCookie('')
                              afterSignIn()
                            }
                          }}
                        >
                          {t('common.save')}
                        </Button>
                      </div>
                    </Field>
                  ) : null}
                </>
              )}
            </Section>
          ) : (
            <Section index={2} title={t('accounts.keyStep')} body={t('onboard.cloudKeyBody')}>
              {pending ? (
                <CloudKeyGuide accountId={pending} done={false} onSaved={back} />
              ) : (
                <p className="text-[13px] text-dim">{t('onboard.cloudNeedsAccount')}</p>
              )}
            </Section>
          )}
        </div>
      )}
    </Modal>
  )
}

function AccountCard({
  account,
  active,
  open,
  busy,
  onUse,
  onToggleKey,
  onRemove,
}: {
  account: Account
  active: boolean
  open: boolean
  busy: boolean
  onUse: () => void
  onToggleKey: () => void
  onRemove: () => void
}) {
  const t = useStore((state) => state.t)

  return (
    <li
      className={cx(
        'overflow-hidden rounded-[var(--radius-panel)] border bg-bg transition-colors',
        active ? 'border-accent/50' : 'border-line'
      )}
    >
      <div className="flex items-center gap-3 p-3">
        {account.avatarUrl ? (
          <img src={account.avatarUrl} alt="" className="size-9 shrink-0 rounded-full" />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised">
            <Icon name="user" className="size-4 text-faint" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.name}</p>
          <p className="truncate text-xs text-faint">@{account.username}</p>
        </div>

        {active ? <Badge tone="accent">{t('accounts.active')}</Badge> : null}
        <Badge tone={account.hasApiKey ? 'ok' : 'warn'}>
          {account.hasApiKey ? t('accounts.hasKey') : t('accounts.noKey')}
        </Badge>

        {active ? null : (
          <Button size="sm" disabled={busy} onClick={onUse}>
            {t('accounts.use')}
          </Button>
        )}

        <IconButton icon="key" title={t('accounts.keyFor')} onClick={onToggleKey} />
        <IconButton icon="trash" tone="danger" title={t('accounts.remove')} onClick={onRemove} />
      </div>

      {open ? (
        <div className="border-t border-line p-3">
          <CloudKeyGuide accountId={account.id} done={account.hasApiKey} />
        </div>
      ) : null}
    </li>
  )
}

function Section({
  index,
  title,
  body,
  children,
}: {
  index: number
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-bg">
      <header className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="truncate text-xs text-faint">{body}</p>
        </div>
      </header>
      <div className="space-y-3 border-t border-line p-4">{children}</div>
    </section>
  )
}
