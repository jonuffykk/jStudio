'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { accounts as accountsApi, history as historyApi, isDesktop, mcpHost, openExternal, secrets } from '@/app/lib/ipc'
import { groupModels, isFreeModel } from '@/app/lib/llm'
import { findProvider, pickDefaultModel, providers } from '@/app/lib/providers'
import { builtinCatalog, importCatalog } from '@/app/lib/net'
import { languageLabels, type Language, type MessageKey } from '@/app/lib/i18n'
import { slugify } from '@/app/lib/skills'
import { systemLanguage, useStore } from '@/app/lib/state'
import {
  mcpServer,
  settings as settingsSchema,
  skill as skillSchema,
  type AgentProfile,
  type CatalogEntry,
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
  Spinner,
  Textarea,
  Toggle,
  cx,
} from '@/app/ui/primitives'

type Tab = 'model' | 'extensions' | 'memory' | 'agents' | 'usage' | 'app'

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
              { value: 'agents', label: t('settings.tabAgents') },
              { value: 'usage', label: t('settings.tabUsage') },
              { value: 'app', label: t('settings.tabApp') },
            ]}
          />

          {tab === 'model' ? <ModelTab /> : null}
          {tab === 'extensions' ? (
            <ExtensionsTab onEditServer={setEditingServer} onEditSkill={setEditingSkill} />
          ) : null}
          {tab === 'memory' ? <MemoryTab onExpand={() => setMemoryOpen(true)} /> : null}
          {tab === 'agents' ? <AgentsTab /> : null}
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
  const { settings, apiKey, models, t } = store
  const provider = findProvider(settings.providerId)

  const [loading, setLoading] = useState(false)
  const list = models[settings.providerId] ?? []

  useEffect(() => {
    let live = true
    store
      .loadModels()
      .then((loaded) => {
        if (!live) return
        if (loaded.length > 0 && !loaded.includes(settings.model)) {
          void store.patchSettings({ model: pickDefaultModel(loaded) })
        }
      })
      .catch(() => {})

    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.providerId, apiKey])

  const groups = groupModels(list.length > 0 ? list : settings.model ? [settings.model] : [])

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
            <div className="flex gap-2">
              <select
                value={settings.model}
                onChange={(event) => void store.patchSettings({ model: event.target.value })}
                className="w-full appearance-none rounded-[var(--radius-control)] border border-line bg-bg px-3 py-2 pr-8 text-sm text-text outline-none transition-colors focus:border-focus"
              >
                {groups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                        {isFreeModel(model) ? ` · ${t('settings.free')}` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {loading ? (
                <span className="flex size-8 items-center justify-center">
                  <Spinner />
                </span>
              ) : (
                <IconButton
                  icon="refresh"
                  title={t('settings.refresh')}
                  onClick={() => {
                    setLoading(true)
                    void store.loadModels(true).finally(() => setLoading(false))
                  }}
                />
              )}
            </div>
          </Line>
        </Card>
      </Section>

      <Section title={t('settings.behaviour')}>
        <Card>
          <Line label={t('settings.mode')} hint={t('settings.modeHint')}>
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

          <Line label={t('settings.temperature')}>
            <div className="w-24">
              <Input
                type="number"
                value={String(settings.temperature)}
                onChange={(value) => void store.patchSettings({ temperature: Number(value) || 0 })}
              />
            </div>
          </Line>

          <Line label={t('settings.maxTurns')}>
            <div className="w-24">
              <Input
                type="number"
                value={String(settings.maxTurns)}
                onChange={(value) => void store.patchSettings({ maxTurns: Number(value) || 8 })}
              />
            </div>
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
  const [manifestUrl, setManifestUrl] = useState('')
  const [library, setLibrary] = useState<CatalogEntry[]>(builtinCatalog)
  const [importing, setImporting] = useState(false)

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

  const addEntry = async (entry: CatalogEntry) => {
    if (entry.kind === 'skill') {
      if (settings.skills.some((item) => item.id === entry.id)) return
      await store.patchSettings({
        skills: [
          ...settings.skills,
          skillSchema.parse({
            id: entry.id,
            name: slugify(entry.name),
            description: entry.description,
            instructions: entry.instructions,
          }),
        ],
      })
      return
    }

    if (settings.mcpServers.some((server) => server.id === entry.id)) return
    const server = mcpServer.parse({
      id: entry.id,
      label: entry.name,
      transport: entry.transport,
      command: entry.command,
      args: entry.args,
      url: entry.url,
    })
    await store.patchSettings({ mcpServers: [...settings.mcpServers, server] })
    await store.connectServer(server)
  }

  const installed = (entry: CatalogEntry) =>
    entry.kind === 'skill'
      ? settings.skills.some((item) => item.id === entry.id)
      : settings.mcpServers.some((server) => server.id === entry.id)

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
          <ServerRow
            icon="film"
            name={t('settings.studioMcp')}
            detail={studioAvailable === false ? t('settings.studioMcpMissing') : t('settings.studioMcpHint')}
            state={statusOf('robloxStudio')}
            actions={null}
          />

          {settings.mcpServers.map((server) => (
            <ServerRow
              key={server.id}
              icon="plugin"
              name={server.label}
              detail={server.transport === 'http' ? server.url : `${server.command} ${server.args.join(' ')}`}
              mono
              state={statusOf(server.id)}
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

      <Section title={t('settings.library')}>
        <div className="flex gap-2">
          <Input value={manifestUrl} onChange={setManifestUrl} placeholder={t('settings.importUrl')} mono />
          <Button
            size="sm"
            disabled={!manifestUrl.trim() || importing}
            onClick={async () => {
              setImporting(true)
              try {
                const entries = await importCatalog(manifestUrl.trim())
                setLibrary([...builtinCatalog, ...entries])
                setManifestUrl('')
              } catch (error) {
                store.toast(error instanceof Error ? error.message : String(error), 'danger')
              } finally {
                setImporting(false)
              }
            }}
          >
            {importing ? <Spinner /> : t('settings.import')}
          </Button>
        </div>

        <Card>
          {library.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-3 py-2.5">
              <Icon name={entry.kind === 'skill' ? 'spark' : 'plugin'} className="size-4 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{entry.name}</p>
                <p className="truncate text-xs text-faint">{entry.description}</p>
              </div>
              {entry.homepage ? (
                <IconButton
                  icon="external"
                  title={entry.homepage}
                  onClick={() => void openExternal(entry.homepage)}
                />
              ) : null}
              {installed(entry) ? (
                <Badge tone="ok">{t('settings.added')}</Badge>
              ) : (
                <Button size="sm" onClick={() => void addEntry(entry)}>
                  {t('settings.add')}
                </Button>
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
  actions,
}: {
  icon: string
  name: string
  detail: string
  mono?: boolean
  state: { tone: 'ok' | 'danger' | 'neutral'; label: string }
  actions: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
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
  )
}

function MemoryTab({ onExpand }: { onExpand: () => void }) {
  const store = useStore()
  const { settings, t } = store

  return (
    <div className="space-y-5">
      <Section title={t('settings.customInstructions')}>
        <Textarea
          rows={6}
          value={settings.customInstructions}
          onChange={(customInstructions) => void store.patchSettings({ customInstructions })}
        />
      </Section>

      <Section title={t('settings.tabMemory')}>
        <Card>
          <Line label={t('settings.memoryOn')} hint={t('settings.memoryHint')}>
            <Toggle
              checked={settings.memory.enabled}
              onChange={(enabled) => void store.patchSettings({ memory: { ...settings.memory, enabled } })}
              label=""
            />
          </Line>

          <Line label={t('settings.useChatHistory')} hint={t('settings.useChatHistoryHint')}>
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

      <p className="text-[13px] text-dim">{t('settings.expandMemoryHint')}</p>

      <div className="flex max-h-[52vh] flex-wrap content-start gap-1.5 overflow-y-auto rounded-[var(--radius-panel)] border border-line bg-bg p-2.5">
        {settings.memory.items.length === 0 ? (
          <p className="px-1 py-4 text-center text-[13px] text-faint">{t('settings.memoryEmpty')}</p>
        ) : (
          settings.memory.items.map((memory) => (
            <span
              key={memory.id}
              className="group flex max-w-full items-baseline gap-1.5 rounded-[var(--radius-control)] bg-accent-soft py-1 pl-2.5 pr-1.5 text-[13px]"
            >
              <span data-selectable className="min-w-0">
                {memory.text}
              </span>
              <button
                type="button"
                title={t('common.delete')}
                onClick={() => forget(memory.id)}
                className="shrink-0 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              >
                <Icon name="close" className="size-3" />
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  )
}

function AgentsTab() {
  const store = useStore()
  const { settings, models, t } = store
  const [open, setOpen] = useState<string | null>(null)

  const list = models[settings.providerId] ?? []
  const active = settings.agents.filter((agent) => agent.enabled).length

  const update = (id: string, patch: Partial<AgentProfile>) =>
    void store.patchSettings({
      agents: settings.agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent)),
    })

  return (
    <Section
      title={t('settings.tabAgents')}
      action={<Badge tone={active > 0 ? 'accent' : 'neutral'}>{t('settings.agentsOn', { count: active })}</Badge>}
    >
      <p className="text-[13px] text-dim">{t('settings.agentHint')}</p>

      <Card>
        {settings.agents.map((agent) => (
          <div key={agent.id}>
            <div className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-raised">
                <Icon name="agent" className="size-4 text-accent" />
              </span>

              <button
                type="button"
                onClick={() => setOpen(open === agent.id ? null : agent.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[13px] font-medium">{agent.name}</span>
                <span className="block truncate text-xs text-faint">{agent.model || t('settings.inherit')}</span>
              </button>

              <IconButton
                icon="chevron"
                title={t('settings.agentRole')}
                onClick={() => setOpen(open === agent.id ? null : agent.id)}
              />
              <Toggle
                checked={agent.enabled}
                onChange={(enabled) => {
                  if (enabled && active >= 3) {
                    store.toast(t('settings.agentHint'), 'danger')
                    return
                  }
                  update(agent.id, { enabled })
                }}
                label=""
              />
            </div>

            {open === agent.id ? (
              <div className="space-y-3 border-t border-line px-3 py-3">
                <Field label={t('settings.agentModel')}>
                  <Select
                    value={agent.model}
                    onChange={(model) => update(agent.id, { model })}
                    options={[
                      { value: '', label: t('settings.inherit') },
                      ...(list.length > 0 ? list : [settings.model]).map((model) => ({
                        value: model,
                        label: model,
                      })),
                    ]}
                  />
                </Field>
                <Field label={t('settings.agentRole')}>
                  <Textarea
                    rows={4}
                    value={agent.instructions}
                    onChange={(instructions) => update(agent.id, { instructions })}
                  />
                </Field>
              </div>
            ) : null}
          </div>
        ))}
      </Card>
    </Section>
  )
}

function UsageTab() {
  const { settings, conversations, t } = useStore()
  const log = settings.usageLog

  const byChat = conversations
    .filter((entry) => entry.usage.input + entry.usage.output > 0)
    .sort((left, right) => right.usage.input + right.usage.output - left.usage.input - left.usage.output)
    .slice(0, 8)

  const [now] = useState(() => Date.now())

  const since = (days: number) => {
    const limit = now - days * 86_400_000
    return log
      .filter((entry) => new Date(entry.day).getTime() >= limit)
      .reduce(
        (sum, entry) => ({
          input: sum.input + entry.input,
          output: sum.output + entry.output,
          runs: sum.runs + entry.runs,
        }),
        { input: 0, output: 0, runs: 0 }
      )
  }

  const cards = [
    { label: t('settings.today'), value: since(1) },
    { label: t('settings.thisWeek'), value: since(7) },
    { label: t('settings.thisMonth'), value: since(30) },
  ]

  const recent = [...log.slice(0, 14)].reverse()
  const peak = Math.max(1, ...recent.map((entry) => entry.input + entry.output))
  const busiest = [...log].sort((a, b) => b.input + b.output - a.input - a.output)[0]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {cards.map((card) => {
          const total = card.value.input + card.value.output
          const share = total > 0 ? (card.value.input / total) * 100 : 0

          return (
            <div key={card.label} className="rounded-[var(--radius-panel)] border border-line bg-bg p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{card.label}</p>
              <p className="mt-1 text-lg font-semibold tracking-tight">{total.toLocaleString()}</p>
              <p className="text-xs text-dim">
                {card.value.runs} {t('settings.runs')}
              </p>

              <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-raised">
                <span className="bg-accent" style={{ width: `${share}%` }} />
                <span className="flex-1 bg-accent/35" />
              </div>
              <p className="mt-1.5 flex justify-between text-[11px] text-faint">
                <span>
                  {t('settings.usageIn')} {card.value.input.toLocaleString()}
                </span>
                <span>
                  {t('settings.usageOut')} {card.value.output.toLocaleString()}
                </span>
              </p>
            </div>
          )
        })}
      </div>

      <Section
        title={t('settings.perDay')}
        action={
          busiest ? (
            <p className="truncate text-[11px] text-faint">
              {t('settings.busiest')} · {busiest.day} · {(busiest.input + busiest.output).toLocaleString()}
            </p>
          ) : null
        }
      >
        <div className="rounded-[var(--radius-panel)] border border-line bg-bg p-3">
          {recent.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-faint">{t('home.empty')}</p>
          ) : (
            <div className="flex h-32 items-end gap-1.5">
              {recent.map((entry) => {
                const total = entry.input + entry.output
                return (
                  <span
                    key={entry.day}
                    title={`${entry.day} · ${total.toLocaleString()}`}
                    className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-1"
                  >
                    <span
                      className="flex flex-col justify-end gap-px rounded-t transition-opacity group-hover:opacity-75"
                      style={{ height: `${(total / peak) * 100}%` }}
                    >
                      <span
                        className="w-full rounded-t bg-accent"
                        style={{ height: `${total > 0 ? (entry.output / total) * 100 : 0}%` }}
                      />
                      <span className="w-full flex-1 bg-accent/35" />
                    </span>
                    <span className="truncate text-center text-[9px] text-faint">{entry.day.slice(5)}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </Section>

      <Section title={t('settings.perChat')}>
        <div className="rounded-[var(--radius-panel)] border border-line bg-bg">
          {byChat.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-faint">{t('home.empty')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {byChat.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  <span className="shrink-0 font-mono text-xs text-faint">
                    {entry.usage.input.toLocaleString()} · {entry.usage.output.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
    for (const conversation of store.conversations) await store.deleteConversation(conversation.id)
  }
  if (everything || target === 'runs') {
    await historyApi.clear()
    await store.refreshRuns()
  }
  if (everything) {
    await store.patchSettings({ memory: { ...useStore.getState().settings.memory, items: [] } })
  }
  if (everything || target === 'usage') {
    await store.patchSettings({ usageLog: [], usagePulse: [] })
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

      <Section title={t('settings.behaviour')}>
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
