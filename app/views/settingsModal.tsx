'use client'

import { useEffect, useState, type ReactNode } from 'react'
import {
  accounts as accountsApi,
  conversations as conversationsApi,
  history as historyApi,
  isDesktop,
  mcpHost,
  openExternal,
  secrets,
} from '@/app/lib/ipc'
import { findProvider, providers } from '@/app/lib/providers'
import { formatCost } from '@/app/lib/models'
import { ModelSelect } from '@/app/ui/modelSelect'
import { UsageBars, UsageSplit, useDayFormat } from '@/app/ui/usageChart'
import { compactTokens, totalsOver } from '@/app/lib/usage'
import { builtinServers } from '@/app/lib/mcp'
import { languageLabels, type Language, type MessageKey } from '@/app/lib/i18n'
import { slugify } from '@/app/lib/skills'
import { systemLanguage, useStore } from '@/app/lib/state'
import {
  mcpServer,
  settings as settingsSchema,
  skill as skillSchema,
  type McpServer,
  type Skill,
} from '@/app/lib/schemas'
import {
  Badge,
  Button,
  Confirm,
  Field,
  Icon,
  IconButton,
  Input,
  Modal,
  Segmented,
  Select,
  Textarea,
  Toggle,
  cx,
} from '@/app/ui/primitives'

type Tab = 'model' | 'extensions' | 'memory' | 'usage' | 'app'

export function SettingsModal() {
  const store = useStore()
  const { settings, t } = store

  const [tab, setTab] = useState<Tab>('model')
  const [editingServer, setEditingServer] = useState<McpServer | null>(null)
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null)
  const [memoryOpen, setMemoryOpen] = useState(false)

  return (
    <Modal open wide onClose={() => store.setModal('none')} title={t('settings.title')}>
      {editingServer ? (
        <ServerEditor
          server={editingServer}
          onBack={() => setEditingServer(null)}
          onSave={async (server) => {
            const rest = settings.mcpServers.filter((entry) => entry.id !== server.id)
            await store.patchSettings({ mcpServers: [...rest, server] })
            await store.connectServer(server)
            setEditingServer(null)
          }}
        />
      ) : memoryOpen ? (
        <MemoryList onBack={() => setMemoryOpen(false)} />
      ) : editingSkill ? (
        <SkillEditor
          skill={editingSkill}
          onBack={() => setEditingSkill(null)}
          onSave={async (entry) => {
            const rest = settings.skills.filter((item) => item.id !== entry.id)
            await store.patchSettings({ skills: [...rest, entry] })
            setEditingSkill(null)
          }}
        />
      ) : (
        <div className="space-y-5">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'model', label: t('settings.tabModel') },
              { value: 'extensions', label: t('settings.tabExtensions') },
              { value: 'memory', label: t('settings.tabMemory') },
              { value: 'usage', label: t('settings.tabUsage') },
              { value: 'app', label: t('settings.tabApp') },
            ]}
          />

          {tab === 'model' ? <ModelTab /> : null}
          {tab === 'extensions' ? (
            <ExtensionsTab onEditServer={setEditingServer} onEditSkill={setEditingSkill} />
          ) : null}
          {tab === 'memory' ? <MemoryTab onExpand={() => setMemoryOpen(true)} /> : null}
            {tab === 'usage' ? <UsageTab /> : null}
          {tab === 'app' ? <AppTab /> : null}
        </div>
      )}
    </Modal>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex h-7 items-center justify-between gap-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-faint">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-bg">
      {children}
    </div>
  )
}

function Line({
  label,
  hint,
  children,
  stacked,
}: {
  label: string
  hint?: string
  children: ReactNode
  stacked?: boolean
}) {
  return (
    <div className={cx('px-3 py-2.5', stacked ? 'space-y-2' : 'flex items-center justify-between gap-6')}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        {hint ? <p className="text-xs text-faint">{hint}</p> : null}
      </div>
      <div className={stacked ? '' : 'shrink-0'}>{children}</div>
    </div>
  )
}

function ModelTab() {
  const store = useStore()
  const { settings, apiKey, t } = store
  const provider = findProvider(settings.providerId)

  return (
    <div className="space-y-5">
      <Section title={t('settings.endpoint')}>
        <Card>
          <Line label={t('settings.provider')} hint={provider.hint} stacked>
            <Select
              value={settings.providerId}
              onChange={(value) => void store.patchSettings({ providerId: value })}
              options={providers.map((entry) => ({ value: entry.id, label: entry.label }))}
            />
          </Line>

          {settings.providerId === 'custom' ? (
            <Line label={t('settings.baseUrl')} stacked>
              <Input
                value={settings.customBaseUrl}
                onChange={(value) => void store.patchSettings({ customBaseUrl: value })}
                placeholder="https://host/v1"
                mono
              />
            </Line>
          ) : null}

          {provider.needsKey ? (
            <Line label={t('settings.apiKey')} stacked>
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
            </Line>
          ) : null}

          <Line label={t('settings.model')} stacked>
            <ModelSelect value={settings.model} onChange={(model) => void store.patchSettings({ model })} />
          </Line>
        </Card>
      </Section>

      <Section title={t('settings.behaviour')}>
        <Card>
          <Line label={t('settings.mode')}>
            <Segmented
              value={settings.mode}
              onChange={(mode) => void store.patchSettings({ mode })}
              options={[
                { value: 'manual', label: t('settings.modeManual') },
                { value: 'auto', label: t('settings.modeAuto') },
                { value: 'plan', label: t('settings.modePlan') },
              ]}
            />
          </Line>

          <Line label={t('settings.approval')}>
            <Segmented
              value={settings.approval}
              onChange={(approval) => void store.patchSettings({ approval })}
              options={[
                { value: 'ask', label: t('settings.approvalAsk') },
                { value: 'auto', label: t('settings.approvalAuto') },
              ]}
            />
          </Line>

          {settings.allowedTools.length > 0 ? (
            <Line label={t('settings.allowedTools')}>
              <div className="flex items-center gap-2">
                <Badge>{settings.allowedTools.length}</Badge>
                <Button
                  size="sm"
                  tone="ghost"
                  onClick={() => void store.patchSettings({ allowedTools: [] })}
                >
                  {t('settings.clearAllowed')}
                </Button>
              </div>
            </Line>
          ) : null}

          <Line label={t('settings.effort')}>
            <Segmented
              value={settings.effort}
              onChange={(effort) => void store.patchSettings({ effort })}
              options={[
                { value: 'low', label: t('settings.effortLow') },
                { value: 'medium', label: t('settings.effortMedium') },
                { value: 'high', label: t('settings.effortHigh') },
              ]}
            />
          </Line>

          <Line label={t('settings.subagents')}>
            <Toggle
              checked={settings.subagents}
              onChange={(subagents) => void store.patchSettings({ subagents })}
              label=""
            />
          </Line>

        </Card>
      </Section>
    </div>
  )
}

function ExtensionsTab({
  onEditServer,
  onEditSkill,
}: {
  onEditServer: (server: McpServer) => void
  onEditSkill: (skill: Skill) => void
}) {
  const store = useStore()
  const { settings, mcp, mcpBusy, t } = store

  const [studioAvailable, setStudioAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isDesktop()) return
    mcpHost
      .detectStudio()
      .then((result) => setStudioAvailable(result.available))
      .catch(() => setStudioAvailable(false))
  }, [])

  const statusOf = (id: string) => {
    const connection = mcp.find((entry) => entry.server.id === id)
    if (mcpBusy && !connection) return { tone: 'neutral' as const, label: t('settings.connecting') }
    if (!connection) return { tone: 'neutral' as const, label: t('settings.offline') }
    if (connection.error) return { tone: 'danger' as const, label: t('settings.offline') }
    return { tone: 'ok' as const, label: `${connection.tools.length} ${t('settings.tools')}` }
  }

  const errorOf = (id: string) => mcp.find((entry) => entry.server.id === id)?.error ?? null

  return (
    <div className="space-y-5">
      <Section
        title={t('settings.mcpServers')}
        action={
          <div className="flex gap-1">
            <IconButton
              icon="refresh"
              title={t('settings.reconnect')}
              onClick={() => void store.reconnectMcp(true)}
            />
            <IconButton
              icon="plus"
              title={t('settings.addServer')}
              onClick={() =>
                onEditServer(
                  mcpServer.parse({
                    id: `server${Date.now()}`,
                    label: 'New server',
                    transport: 'http',
                    url: 'https://',
                  })
                )
              }
            />
          </div>
        }
      >
        <Card>
          {builtinServers.map((server) => (
            <ServerRow
              key={server.id}
              icon={server.id === 'robloxStudio' ? 'film' : 'book'}
              name={server.id === 'robloxStudio' ? t('settings.studioMcp') : server.label}
              detail={
                server.id === 'robloxStudio'
                  ? studioAvailable === false
                    ? t('settings.studioMcpMissing')
                    : t('settings.studioMcpHint')
                  : server.url
              }
              mono={server.id !== 'robloxStudio'}
              state={statusOf(server.id)}
              error={errorOf(server.id)}
              actions={null}
            />
          ))}

          {settings.mcpServers.map((server) => (
            <ServerRow
              key={server.id}
              icon="plugin"
              name={server.label}
              detail={server.transport === 'http' ? server.url : `${server.command} ${server.args.join(' ')}`}
              mono
              state={statusOf(server.id)}
              error={errorOf(server.id)}
              actions={
                <>
                  <IconButton icon="edit" title={t('common.open')} onClick={() => onEditServer(server)} />
                  <IconButton
                    icon="trash"
                    tone="danger"
                    title={t('accounts.remove')}
                    onClick={async () => {
                      await store.patchSettings({
                        mcpServers: settings.mcpServers.filter((entry) => entry.id !== server.id),
                      })
                      await store.dropServer(server.id)
                    }}
                  />
                </>
              }
            />
          ))}
        </Card>
      </Section>

      <Section
        title={t('settings.skills')}
        action={
          <IconButton
            icon="plus"
            title={t('settings.addSkill')}
            onClick={() =>
              onEditSkill(skillSchema.parse({ id: `skill${Date.now()}`, name: 'new-skill', instructions: '' }))
            }
          />
        }
      >

        <Card>
          {settings.skills.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px]">/{entry.name}</p>
                <p className="truncate text-xs text-faint">{entry.description}</p>
              </div>

              <span title={t('settings.skillAtStart')}>
                <Toggle
                  checked={entry.enabled}
                  onChange={(value) =>
                    void store.patchSettings({
                      skills: settings.skills.map((item) =>
                        item.id === entry.id ? { ...item, enabled: value } : item
                      ),
                    })
                  }
                  label=""
                />
              </span>

              {entry.builtin ? null : (
                <>
                  <IconButton icon="edit" title={t('common.open')} onClick={() => onEditSkill(entry)} />
                  <IconButton
                    icon="trash"
                    tone="danger"
                    title={t('common.delete')}
                    onClick={() =>
                      void store.patchSettings({
                        skills: settings.skills.filter((item) => item.id !== entry.id),
                      })
                    }
                  />
                </>
              )}
            </div>
          ))}
        </Card>
      </Section>

    </div>
  )
}

function ServerRow({
  icon,
  name,
  detail,
  mono,
  state,
  error,
  actions,
}: {
  icon: string
  name: string
  detail: string
  mono?: boolean
  state: { tone: 'ok' | 'danger' | 'neutral'; label: string }
  error?: string | null
  actions: ReactNode
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-raised">
          <Icon name={icon} className="size-4 text-accent" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{name}</p>
          <p className={cx('truncate text-xs text-faint', mono && 'font-mono')}>{detail}</p>
        </div>

        <Badge tone={state.tone}>{state.label}</Badge>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </div>

      {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : null}
    </div>
  )
}

const roles = ['none', 'solo', 'studio', 'scripter', 'artist', 'builder', 'learning'] as const

function MemoryTab({ onExpand }: { onExpand: () => void }) {
  const store = useStore()
  const { settings, t } = store
  const account = store.activeAccount()

  const patchProfile = (patch: Partial<typeof settings.profile>) =>
    void store.patchSettings({ profile: { ...settings.profile, ...patch } })

  return (
    <div className="space-y-5">
      <Section title={t('settings.profile')}>
        <Card>
          <Line label={t('settings.avatar')}>
            <span className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-raised text-xs font-medium text-dim">
              {account?.avatarUrl ? (
                <img src={account.avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                (account?.name ?? '?').slice(0, 2).toUpperCase()
              )}
            </span>
          </Line>

          <Line label={t('settings.robloxName')}>
            <span className="text-[13px] text-dim">
              {account ? `${account.name} · @${account.username}` : t('settings.noAccount')}
            </span>
          </Line>

          <Line label={t('settings.nickname')}>
            <div className="w-56">
              <Input
                value={settings.profile.nickname}
                placeholder={account?.name ?? ''}
                onChange={(nickname) => patchProfile({ nickname })}
              />
            </div>
          </Line>

          <Line label={t('settings.role')}>
            <div className="w-56">
              <Select
                value={settings.profile.role}
                onChange={(role) => patchProfile({ role })}
                options={roles.map((value) => ({
                  value,
                  label: t(`settings.role_${value}` as MessageKey),
                }))}
              />
            </div>
          </Line>
        </Card>
      </Section>

      <Section title={t('settings.customInstructions')}>
        <Textarea
          rows={6}
          value={settings.customInstructions}
          onChange={(customInstructions) => void store.patchSettings({ customInstructions })}
        />
      </Section>

      <Section title={t('settings.tabMemory')}>
        <Card>
          <Line label={t('settings.memoryOn')}>
            <Toggle
              checked={settings.memory.enabled}
              onChange={(enabled) => void store.patchSettings({ memory: { ...settings.memory, enabled } })}
              label=""
            />
          </Line>

          <Line label={t('settings.useChatHistory')}>
            <Toggle
              checked={settings.useChatHistory}
              onChange={(useChatHistory) => void store.patchSettings({ useChatHistory })}
              label=""
            />
          </Line>

          <Line label={t('settings.savedFacts')}>
            <div className="flex items-center gap-2">
              <Badge>{settings.memory.items.length}</Badge>
              <Button size="sm" tone="ghost" icon="chevron" onClick={onExpand}>
                {t('settings.expandMemory')}
              </Button>
            </div>
          </Line>
        </Card>
      </Section>
    </div>
  )
}

function MemoryList({ onBack }: { onBack: () => void }) {
  const store = useStore()
  const { settings, t } = store

  const forget = (id: string) =>
    void store.patchSettings({
      memory: { ...settings.memory, items: settings.memory.items.filter((entry) => entry.id !== id) },
    })

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[13px] text-faint transition-colors hover:text-text"
      >
        <Icon name="chevron" className="size-3.5 rotate-180" />
        {t('settings.tabMemory')}
      </button>

      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-bg">
        {settings.memory.items.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-faint">{t('settings.memoryEmpty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {settings.memory.items.map((memory) => (
              <li key={memory.id} className="group flex items-start gap-2 px-3 py-2">
                <Icon name="memory" className="mt-0.5 size-3.5 shrink-0 text-accent" />
                <span data-selectable className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px]">
                  {memory.text}
                </span>
                <button
                  type="button"
                  title={t('common.delete')}
                  onClick={() => forget(memory.id)}
                  className="mt-0.5 shrink-0 text-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Icon name="close" className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function UsageTab() {
  const store = useStore()
  const { t } = store
  const log = store.usage.days

  const [now] = useState(() => Date.now())
  const dayLabel = useDayFormat()

  const today = totalsOver(log, 1, now)
  const week = totalsOver(log, 7, now)
  const month = totalsOver(log, 30, now)
  const total = month.input + month.output
  const busiest = [...log].sort((a, b) => b.input + b.output - a.input - a.output)[0]

  const rows = [
    { label: t('settings.thisWeek'), value: week.input + week.output > 0 ? compactTokens(week.input + week.output) : '—' },
    { label: t('settings.thisMonth'), value: total > 0 ? compactTokens(total) : '—' },
    { label: t('usage.average'), value: month.days > 0 ? compactTokens(Math.round(total / month.days)) : '—' },
    { label: t('usage.perTurn'), value: month.runs > 0 ? compactTokens(Math.round(total / month.runs)) : '—' },
    { label: t('usage.ratio'), value: month.output > 0 ? `${Math.round(month.input / month.output)}:1` : '—' },
    { label: t('usage.busiest'), value: busiest ? dayLabel(busiest.day) : '—' },
    ...(month.cost > 0 ? [{ label: t('usage.cost'), value: formatCost(month.cost) }] : []),
  ]

  if (log.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <Icon name="chart" className="size-6 text-faint" />
        <p className="text-[13px] text-dim">{t('usage.empty')}</p>
        <p className="text-xs text-faint">{t('usage.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-panel)] border border-line bg-bg p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{t('settings.today')}</p>
        <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">
          {(today.input + today.output).toLocaleString()}
        </p>
        <p className="text-xs text-dim">
          {today.runs} {t('settings.runs')}
          {today.cost > 0 ? ` · ${formatCost(today.cost)}` : ''}
        </p>

        <div className="mt-4">
          <UsageSplit input={today.input} output={today.output} />
        </div>
      </div>

      <Section title={t('usage.perDay')}>
        <div className="rounded-[var(--radius-panel)] border border-line bg-bg p-3">
          <UsageBars days={log} />
        </div>
      </Section>

      <Section title={t('usage.summary')}>
        <Card>
          {rows.map((row) => (
            <Line key={row.label} label={row.label}>
              <span className="font-mono text-[13px] tabular-nums text-dim">{row.value}</span>
            </Line>
          ))}
        </Card>
      </Section>

    </div>
  )
}

type Wipe = 'chats' | 'runs' | 'usage' | 'settings' | 'all'

const wipeLabels: Record<Wipe, MessageKey> = {
  chats: 'settings.clearChats',
  runs: 'settings.clearRuns',
  usage: 'settings.clearUsage',
  settings: 'settings.resetSettings',
  all: 'settings.clearAll',
}

async function wipe(target: Wipe): Promise<void> {
  const store = useStore.getState()
  const everything = target === 'all'

  if (everything || target === 'chats') {
    await conversationsApi.clear()
    useStore.setState({ conversations: [] })
  }
  if (everything || target === 'runs') {
    await historyApi.clear()
    await store.refreshRuns()
  }
  if (everything) {
    await store.patchSettings({ memory: { ...useStore.getState().settings.memory, items: [] } })
  }
  if (everything || target === 'usage') {
    await store.clearUsage()
  }
  if (everything) {
    for (const account of store.accounts) await accountsApi.remove(account.id)
    await store.refreshAccounts()
  }
  if (everything || target === 'settings') {
    for (const provider of providers) await secrets.set(`apiKey.${provider.id}`, '')

    const fresh = settingsSchema.parse({})
    await store.patchSettings({ ...fresh, language: systemLanguage(), onboarded: false, intent: [] })
    useStore.setState({ apiKey: '' })
  }
}

function AppTab() {
  const store = useStore()
  const { settings, t } = store
  const [confirm, setConfirm] = useState<Wipe | null>(null)

  return (
    <div className="space-y-5">
      <Section title={t('settings.theme')}>
        <Card>
          <Line label={t('settings.theme')}>
            <Segmented
              value={settings.theme}
              onChange={(theme) => void store.patchSettings({ theme })}
              options={[
                { value: 'light', label: t('common.light') },
                { value: 'dark', label: t('common.dark') },
                { value: 'system', label: t('common.system') },
              ]}
            />
          </Line>

          <Line label={t('settings.language')}>
            <div className="w-40">
              <Select
                value={settings.language}
                onChange={(value) =>
                  void store.patchSettings({ language: value as Language, languagePicked: true })
                }
                options={(Object.keys(languageLabels) as Language[]).map((code) => ({
                  value: code,
                  label: languageLabels[code],
                }))}
              />
            </div>
          </Line>
        </Card>
      </Section>

      <Section title={t('settings.setup')}>
        <Card>
          <Line label={t('onboard.intentBuild')}>
            <Toggle
              checked={settings.intent.includes('build')}
              onChange={(on) =>
                void store.patchSettings({
                  intent: on
                    ? [...settings.intent, 'build' as const]
                    : settings.intent.filter((entry) => entry !== 'build'),
                })
              }
              label=""
            />
          </Line>
          <Line label={t('onboard.intentAnimations')}>
            <Toggle
              checked={settings.intent.includes('animations')}
              onChange={(on) =>
                void store.patchSettings({
                  intent: on
                    ? [...settings.intent, 'animations' as const]
                    : settings.intent.filter((entry) => entry !== 'animations'),
                })
              }
              label=""
            />
          </Line>
          <Line label={t('settings.rerunSetup')}>
            <Button
              size="sm"
              onClick={() => {
                store.setModal('none')
                void store.patchSettings({ onboarded: false })
              }}
            >
              {t('settings.rerunSetupAction')}
            </Button>
          </Line>
        </Card>
      </Section>

      <Section title={t('settings.interface')}>
        <Card>
          <Line label={t('settings.sendOnEnter')}>
            <Toggle
              checked={settings.sendOnEnter}
              onChange={(sendOnEnter) => void store.patchSettings({ sendOnEnter })}
              label=""
            />
          </Line>
          <Line label={t('settings.showReasoning')}>
            <Toggle
              checked={settings.showReasoning}
              onChange={(showReasoning) => void store.patchSettings({ showReasoning })}
              label=""
            />
          </Line>
          <Line label={t('settings.sounds')}>
            <Toggle
              checked={settings.sounds}
              onChange={(sounds) => void store.patchSettings({ sounds })}
              label=""
            />
          </Line>
        </Card>
      </Section>

      <Section title={t('settings.data')}>
        <Card>
          <Line label={t('settings.clearChats')}>
            <Button size="sm" tone="danger" onClick={() => setConfirm('chats')}>
              {t('common.delete')}
            </Button>
          </Line>
          <Line label={t('settings.clearRuns')}>
            <Button size="sm" tone="danger" onClick={() => setConfirm('runs')}>
              {t('common.delete')}
            </Button>
          </Line>
          <Line label={t('settings.clearUsage')}>
            <Button size="sm" tone="danger" onClick={() => setConfirm('usage')}>
              {t('common.delete')}
            </Button>
          </Line>
          <Line label={t('settings.resetSettings')}>
            <Button size="sm" tone="danger" onClick={() => setConfirm('settings')}>
              {t('settings.reset')}
            </Button>
          </Line>
          <Line label={t('settings.clearAll')}>
            <Button size="sm" tone="danger" onClick={() => setConfirm('all')}>
              {t('settings.wipe')}
            </Button>
          </Line>
        </Card>
      </Section>

      <Confirm
        open={confirm !== null}
        title={confirm ? t(wipeLabels[confirm]) : ''}
        body={confirm === 'all' ? t('settings.clearAllBody') : t('common.confirmDelete')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const target = confirm
          setConfirm(null)
          if (!target) return

          await wipe(target)
          store.toast(t('settings.cleared'), 'ok')
          if (target === 'all' || target === 'settings') store.setModal('none')
        }}
      />
    </div>
  )
}

function ServerEditor({
  server,
  onBack,
  onSave,
}: {
  server: McpServer
  onBack: () => void
  onSave: (server: McpServer) => void
}) {
  const { t } = useStore()
  const [draft, setDraft] = useState<McpServer>(server)

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[13px] text-faint transition-colors hover:text-text"
      >
        <Icon name="chevron" className="size-3.5 rotate-180" />
        {t('settings.mcpServers')}
      </button>

      <Field label="Label">
        <Input value={draft.label} onChange={(label) => setDraft({ ...draft, label })} />
      </Field>
      <Field label="Transport">
        <Select
          value={draft.transport}
          onChange={(transport) => setDraft({ ...draft, transport })}
          options={[
            { value: 'http', label: 'Streamable HTTP' },
            { value: 'stdio', label: 'Local process' },
          ]}
        />
      </Field>

      {draft.transport === 'http' ? (
        <Field label="URL">
          <Input value={draft.url} onChange={(url) => setDraft({ ...draft, url })} mono />
        </Field>
      ) : (
        <>
          <Field label="Command">
            <Input value={draft.command} onChange={(command) => setDraft({ ...draft, command })} mono />
          </Field>
          <Field label="Arguments" hint="One per line">
            <Textarea
              rows={3}
              value={draft.args.join('\n')}
              onChange={(value) => setDraft({ ...draft, args: value.split('\n').filter(Boolean) })}
            />
          </Field>
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button size="sm" tone="ghost" onClick={onBack}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" tone="primary" onClick={() => onSave(draft)}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}

function SkillEditor({
  skill,
  onBack,
  onSave,
}: {
  skill: Skill
  onBack: () => void
  onSave: (skill: Skill) => void
}) {
  const { t } = useStore()
  const [draft, setDraft] = useState<Skill>(skill)

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[13px] text-faint transition-colors hover:text-text"
      >
        <Icon name="chevron" className="size-3.5 rotate-180" />
        {t('settings.skills')}
      </button>

      <Field label={t('settings.skillName')} hint={`/${draft.name}`}>
        <Input value={draft.name} onChange={(name) => setDraft({ ...draft, name: slugify(name) })} mono />
      </Field>
      <Field label={t('settings.skillDescription')}>
        <Input value={draft.description} onChange={(description) => setDraft({ ...draft, description })} />
      </Field>
      <Field label={t('settings.skillInstructions')}>
        <Textarea
          rows={10}
          value={draft.instructions}
          onChange={(instructions) => setDraft({ ...draft, instructions })}
        />
      </Field>

      <div className="flex justify-end gap-2">
        <Button size="sm" tone="ghost" onClick={onBack}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" tone="primary" onClick={() => onSave(draft)}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}
