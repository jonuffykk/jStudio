'use client'

import { useState } from 'react'
import { accounts as accountsApi } from '@/app/lib/ipc'
import { useStore } from '@/app/lib/state'
import { CloudKeyGuide } from '@/app/views/onboarding'
import { Badge, Button, Confirm, Field, Icon, IconButton, Input, Modal, Spinner, cx } from '@/app/ui/primitives'

type Stage = 'list' | 'signIn' | 'key'

export function AccountsModal() {
  const store = useStore()
  const { accounts, activeAccountId, t } = store

  const [stage, setStage] = useState<Stage>('list')
  const [pending, setPending] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [cookie, setCookie] = useState('')
  const [working, setWorking] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

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

  const afterSignIn = async () => {
    await store.refreshAccounts()
    const id = useStore.getState().activeAccountId
    setPending(id)
    setStage(useStore.getState().accounts.find((entry) => entry.id === id)?.hasApiKey ? 'list' : 'key')
  }

  return (
    <Modal open onClose={() => store.setModal('none')} title={t('accounts.title')}>
      {stage === 'list' ? (
        <div className="space-y-4">
          {accounts.length === 0 ? (
            <p className="text-[13px] text-faint">{t('accounts.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className={cx(
                    'rounded-[var(--radius-control)] border bg-bg',
                    account.id === activeAccountId ? 'border-focus' : 'border-line'
                  )}
                >
                  <div className="flex items-center gap-3 p-3">
                    {account.avatarUrl ? (
                      <img src={account.avatarUrl} alt="" className="size-9 shrink-0 rounded-full" />
                    ) : (
                      <span className="size-9 shrink-0 rounded-full bg-raised" />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{account.name}</p>
                      <p className="truncate text-xs text-faint">@{account.username}</p>
                    </div>

                    {account.hasApiKey ? (
                      <Badge tone="ok">{t('accounts.hasKey')}</Badge>
                    ) : (
                      <Badge tone="warn">{t('accounts.noKey')}</Badge>
                    )}

                    {account.id === activeAccountId ? (
                      <Badge tone="accent">{t('accounts.active')}</Badge>
                    ) : (
                      <Button size="sm" onClick={() => void run(() => accountsApi.setActive(account.id))}>
                        {t('accounts.use')}
                      </Button>
                    )}

                    <IconButton
                      icon="key"
                      title={t('accounts.keyFor')}
                      onClick={() => setEditing(editing === account.id ? null : account.id)}
                    />
                    <IconButton
                      icon="trash"
                      tone="danger"
                      title={t('accounts.remove')}
                      onClick={() => setRemoving(account.id)}
                    />
                  </div>

                  {editing === account.id ? (
                    <div className="border-t border-line p-3">
                      <CloudKeyGuide accountId={account.id} done={account.hasApiKey} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <Button full icon="plus" onClick={() => setStage('signIn')}>
            {t('accounts.addAnother')}
          </Button>

          <Confirm
            open={removing !== null}
            title={t('accounts.remove')}
            body={t('common.confirmDelete')}
            confirmLabel={t('accounts.remove')}
            cancelLabel={t('common.cancel')}
            onCancel={() => setRemoving(null)}
            onConfirm={async () => {
              const id = removing
              setRemoving(null)
              if (!id) return

              await run(() => accountsApi.remove(id))
              setStage('list')
              setEditing(null)
              if (useStore.getState().accounts.length === 0) store.setModal('none')
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            disabled={working}
            onClick={() => setStage('list')}
            className="flex items-center gap-1.5 text-[13px] text-faint transition-colors hover:text-text"
          >
            <Icon name="chevron" className="size-3.5 rotate-180" />
            {t('accounts.back')}
          </button>

          {stage === 'signIn' ? (
            working ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Spinner className="size-5" />
                <p className="text-sm font-medium">{t('accounts.signingIn')}</p>
                <p className="max-w-xs text-[13px] text-dim">{t('accounts.signingInBody')}</p>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-semibold">{t('accounts.step')}</h3>

                <Button
                  tone="primary"
                  full
                  icon="user"
                  onClick={async () => {
                    if (await run(accountsApi.signIn)) await afterSignIn()
                  }}
                >
                  {t('accounts.signIn')}
                </Button>

                <div className="flex items-center gap-3 text-xs text-faint">
                  <span className="h-px flex-1 bg-line" />
                  {t('accounts.advanced')}
                  <span className="h-px flex-1 bg-line" />
                </div>

                <Field label={t('accounts.cookie')}>
                  <div className="flex gap-2">
                    <Input type="password" value={cookie} onChange={setCookie} mono />
                    <IconButton
                      icon="check"
                      title={t('common.save')}
                      disabled={!cookie.trim()}
                      onClick={async () => {
                        if (await run(() => accountsApi.signInWithCookie(cookie.trim()))) {
                          setCookie('')
                          await afterSignIn()
                        }
                      }}
                    />
                  </div>
                </Field>
              </>
            )
          ) : (
            <>
              <h3 className="text-sm font-semibold">{t('accounts.keyStep')}</h3>
              {pending ? (
                <CloudKeyGuide accountId={pending} done={false} onSaved={() => setStage('list')} />
              ) : null}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
