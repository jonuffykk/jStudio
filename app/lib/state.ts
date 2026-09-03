'use client'

import { create } from 'zustand'
import {
  accounts as accountsApi,
  config,
  conversations as conversationsApi,
  history as historyApi,
  listen,
  plugin as pluginApi,
  secrets,
  studio,
} from '@/app/lib/ipc'
import { connect, disconnect, studioServer, type McpConnection } from '@/app/lib/mcp'
import type { McpServer } from '@/app/lib/schemas'
import { translate, type Language, type MessageKey } from '@/app/lib/i18n'
import { mergeSkills } from '@/app/lib/skills'
import { findProvider } from '@/app/lib/providers'
import { listModels, resolveEndpoint } from '@/app/lib/llm'
import { checkUpdate } from '@/app/lib/host'
import {
  bridgeStatus as bridgeStatusSchema,
  defaultAgents,
  pluginStatus as pluginStatusSchema,
  settings as settingsSchema,
  type Account,
  type AssetKind,
  type AgentProfile,
  type BridgeStatus,
  type Conversation,
  type PluginStatus,
  type ProjectNode,
  type RunRecord,
  type Settings,
} from '@/app/lib/schemas'

export type View = 'home' | 'build' | 'assets'
export type Stop = { view: View; chat?: string }

export type Modal = 'none' | 'accounts' | 'settings'

export type Toast = { id: number; text: string; tone: 'info' | 'ok' | 'danger' }

export type SpoofStatus =
  | 'found'
  | 'downloading'
  | 'uploading'
  | 'retrying'
  | 'uploaded'
  | 'saved'
  | 'cached'
  | 'owned'
  | 'failed'

export type SpoofItem = {
  id: string
  name: string
  status: SpoofStatus
  newId?: string
  reason?: string
  detail?: string
  free?: boolean
  at: number
}

type Store = {
  booted: boolean
  ready: boolean
  view: View
  modal: Modal
  paletteOpen: boolean
  mcpBusy: boolean
  focusRun: string | null
  updateVersion: string | null
  trail: Stop[]
  trailIndex: number
  railOpen: boolean
  settings: Settings
  apiKey: string
  status: BridgeStatus
  plugin: PluginStatus
  nodes: ProjectNode[]
  truncated: boolean
  accounts: Account[]
  activeAccountId: string | null
  runs: RunRecord[]
  conversations: Conversation[]
  mcp: McpConnection[]
  toasts: Toast[]
  spoofRunning: boolean
  spoofPaused: boolean
  spoofKind: AssetKind
  spoofStatus: string
  spoofProgress: { total: number; done: number; failed: number }
  spoofItems: SpoofItem[]
  models: Record<string, string[]>

  t: (key: MessageKey, values?: Record<string, string | number>) => string
  activeAccount: () => Account | undefined
  studioMcpReady: () => boolean
  setModal: (modal: Modal) => void
  openRun: (id: string | null) => void
  aiReady: () => boolean
  robloxReady: () => boolean
  cloudReady: () => boolean
  blockers: () => MessageKey[]
  setView: (view: View) => void
  visitChat: (id: string) => void
  setRail: (open: boolean) => void
  canBack: () => boolean
  canForward: () => boolean
  goBack: () => void
  goForward: () => void
  setPalette: (open: boolean) => void
  toast: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
  patchSettings: (patch: Partial<Settings>) => Promise<void>
  setApiKey: (value: string) => Promise<void>
  refreshStatus: () => Promise<void>
  refreshTree: () => Promise<void>
  refreshAccounts: () => Promise<void>
  refreshRuns: () => Promise<void>
  patchRun: (id: string, patch: { label?: string; pinned?: boolean; archived?: boolean }) => Promise<void>
  removeRun: (id: string) => Promise<void>
  saveConversation: (conversation: Conversation) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  reconnectMcp: (announce?: boolean) => Promise<void>
  connectServer: (server: McpServer) => Promise<void>
  dropServer: (id: string) => Promise<void>
  loadModels: (force?: boolean) => Promise<string[]>
  rememberFact: (text: string) => void
  recordUsage: (input: number, output: number) => void
  notify: (body: string) => void
  resetSpoof: () => void
  lookForUpdate: () => Promise<void>
  bootstrap: () => Promise<void>
}

function travel(
  get: () => Store,
  set: (patch: Partial<Store>) => void,
  step: number
): void {
  const state = get()
  const index = state.trailIndex + step
  const stop = state.trail[index]
  if (!stop) return

  set({ trailIndex: index, view: stop.view, modal: 'none', paletteOpen: false })
  if (stop.view !== 'build') return

  const conversation = stop.chat ? state.conversations.find((entry) => entry.id === stop.chat) : undefined
  window.dispatchEvent(
    conversation
      ? new CustomEvent('jstudio:openChat', { detail: conversation })
      : new CustomEvent('jstudio:newChat')
  )
}

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

const resolveTheme = (theme: Settings['theme']): 'dark' | 'light' =>
  theme === 'system' ? (prefersDark() ? 'dark' : 'light') : theme

function paintTheme(theme: Settings['theme']): void {
  const tone = resolveTheme(theme)
  const root = document.documentElement
  root.dataset.theme = tone
  root.style.background = tone === 'light' ? '#f6f6f8' : '#0b0b0f'
  localStorage.setItem('jstudio.theme', JSON.stringify(theme))
}

export function systemLanguage(): Language {
  const tag = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase()
  if (tag.startsWith('pt')) return 'pt'
  if (tag.startsWith('es')) return 'es'
  return 'en'
}

const emptySettings = settingsSchema.parse({})
let toastId = 0
let factId = 0

const newFactId = () => `mem${Date.now().toString(36)}${(factId += 1).toString(36)}`

function mergeAgents(stored: AgentProfile[]): AgentProfile[] {
  return defaultAgents.map((preset) => {
    const saved = stored.find((entry) => entry.id === preset.id)
    return saved ? { ...preset, model: saved.model, instructions: saved.instructions, enabled: saved.enabled } : preset
  })
}

export const useStore = create<Store>((set, get) => ({
  booted: false,
  ready: false,
  view: 'home',
  modal: 'none',
  paletteOpen: false,
  mcpBusy: false,
  focusRun: null,
  updateVersion: null,
  trail: [{ view: 'home' }],
  trailIndex: 0,
  railOpen: true,
  settings: emptySettings,
  apiKey: '',
  status: bridgeStatusSchema.parse({}),
  plugin: pluginStatusSchema.parse({}),
  nodes: [],
  truncated: false,
  accounts: [],
  activeAccountId: null,
  runs: [],
  conversations: [],
  mcp: [],
  toasts: [],
  spoofRunning: false,
  spoofPaused: false,
  spoofKind: 'animation',
  spoofStatus: '',
  spoofProgress: { total: 0, done: 0, failed: 0 },
  spoofItems: [],
  models: {},

  t: (key, values) => translate(get().settings.language as Language, key, values),

  activeAccount: () => {
    const { accounts, activeAccountId } = get()
    return accounts.find((entry) => entry.id === activeAccountId)
  },

  aiReady: () => {
    const { settings, apiKey } = get()
    return (!findProvider(settings.providerId).needsKey || !!apiKey) && !!settings.model
  },

  robloxReady: () => !!get().activeAccount(),

  cloudReady: () => !!get().activeAccount()?.hasApiKey,

  blockers: () => {
    const missing: MessageKey[] = []
    const wants = get().settings.intent

    if (wants.includes('build') && !get().aiReady()) missing.push('onboard.provider')
    if (wants.includes('animations')) {
      if (!get().robloxReady()) missing.push('onboard.roblox')
      else if (!get().cloudReady()) missing.push('onboard.cloudKey')
    }

    return missing
  },

  studioMcpReady: () => {
    const connection = get().mcp.find((entry) => entry.server.id === 'robloxStudio')
    return !!connection && !connection.error && connection.tools.length > 0
  },

  setModal: (modal) => set({ modal, paletteOpen: false }),
  openRun: (focusRun) =>
    set(focusRun ? { focusRun, view: 'assets', modal: 'none' } : { focusRun: null }),

  setView: (view) =>
    set((state) => {
      if (state.view === view) return { view, paletteOpen: false, modal: 'none' }
      const trail = [...state.trail.slice(0, state.trailIndex + 1), { view }].slice(-30)
      return { view, paletteOpen: false, modal: 'none', trail, trailIndex: trail.length - 1 }
    }),

  visitChat: (chat) =>
    set((state) => {
      const current = state.trail[state.trailIndex]
      if (current?.view === 'build' && current.chat === chat) return state

      const trail = [...state.trail.slice(0, state.trailIndex + 1), { view: 'build' as const, chat }].slice(-30)
      return { view: 'build' as const, trail, trailIndex: trail.length - 1 }
    }),

  setRail: (railOpen) => set({ railOpen }),

  canBack: () => get().trailIndex > 0,
  canForward: () => get().trailIndex < get().trail.length - 1,

  goBack: () => travel(get, set, -1),
  goForward: () => travel(get, set, 1),
  setPalette: (paletteOpen) => set({ paletteOpen }),

  toast: (text, tone = 'info') => {
    const id = ++toastId
    set((state) => ({ toasts: [...state.toasts, { id, text, tone }] }))
    setTimeout(() => get().dismissToast(id), 5000)
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) })),

  patchSettings: async (patch) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })

    if (patch.theme) {
      paintTheme(patch.theme)
    }
    if (patch.providerId) {
      set({ apiKey: await secrets.get(`apiKey.${patch.providerId}`) })
    }
    await config.save(next).catch(() => {})
  },

  setApiKey: async (value) => {
    set({ apiKey: value })
    await secrets.set(`apiKey.${get().settings.providerId}`, value.trim())
  },

  refreshStatus: async () => {
    const [status, plugin] = await Promise.all([studio.status(), pluginApi.status()])
    set({ status, plugin })
  },

  refreshTree: async () => {
    const tree = await studio.tree()
    set({ nodes: tree.nodes, truncated: tree.truncated })
  },

  refreshAccounts: async () => {
    const list = await accountsApi.list()
    set({ accounts: list.accounts, activeAccountId: list.activeId })
  },

  refreshRuns: async () => set({ runs: await historyApi.runs() }),

  patchRun: async (id, patch) => set({ runs: await historyApi.patch(id, patch) }),

  removeRun: async (id) => set({ runs: await historyApi.remove(id) }),

  saveConversation: async (conversation) => {
    set({ conversations: await conversationsApi.save(conversation) })
  },

  deleteConversation: async (id) => {
    set({ conversations: await conversationsApi.remove(id) })
  },

  reconnectMcp: async (announce = false) => {
    if (get().mcpBusy) return
    set({ mcpBusy: true })

    try {
      for (const connection of get().mcp) await disconnect(connection.server)

      const { settings } = get()
      const servers = [
        ...(settings.studioMcpEnabled ? [studioServer] : []),
        ...settings.mcpServers.filter((server) => server.enabled),
      ]

      const connections = await Promise.all(servers.map(connect))
      if (announce) {
        for (const connection of connections) {
          if (connection.error) get().toast(`${connection.server.label}: ${connection.error}`, 'danger')
        }
      }
      set({ mcp: connections })
    } finally {
      set({ mcpBusy: false })
    }
  },

  connectServer: async (server) => {
    const connection = await connect(server)
    if (connection.error) get().toast(`${connection.server.label}: ${connection.error}`, 'danger')
    set((state) => ({
      mcp: [...state.mcp.filter((entry) => entry.server.id !== server.id), connection],
    }))
  },

  dropServer: async (id) => {
    const connection = get().mcp.find((entry) => entry.server.id === id)
    if (connection) await disconnect(connection.server)
    set((state) => ({ mcp: state.mcp.filter((entry) => entry.server.id !== id) }))
  },

  loadModels: async (force = false) => {
    const { settings, apiKey, models } = get()
    const cached = models[settings.providerId]
    if (cached && !force) return cached

    try {
      const list = await listModels(
        resolveEndpoint({
          providerId: settings.providerId,
          customBaseUrl: settings.customBaseUrl,
          apiKey,
          model: settings.model,
          temperature: settings.temperature,
          effort: settings.effort,
        })
      )
      set((state) => ({ models: { ...state.models, [settings.providerId]: list } }))
      return list
    } catch (error) {
      if (force) get().toast(error instanceof Error ? error.message : String(error), 'danger')
      return cached ?? []
    }
  },

  rememberFact: (text) => {
    const { settings } = get()
    if (!settings.memory.enabled) return

    const clean = text.trim().slice(0, 400)
    if (!clean || settings.memory.items.some((entry) => entry.text === clean)) return

    void get().patchSettings({
      memory: {
        ...settings.memory,
        items: [{ id: newFactId(), text: clean, at: Date.now() }, ...settings.memory.items].slice(0, 200),
      },
    })
  },

  recordUsage: (input, output) => {
    const { settings } = get()
    const day = new Date().toISOString().slice(0, 10)
    const log = [...settings.usageLog]
    const index = log.findIndex((entry) => entry.day === day)

    if (index === -1) log.unshift({ day, input, output, runs: 1 })
    else {
      const current = log[index]
      if (current) {
        log[index] = {
          day,
          input: current.input + input,
          output: current.output + output,
          runs: current.runs + 1,
        }
      }
    }

    const cutoff = Date.now() - 172_800_000
    const pulse = [...settings.usagePulse, { at: Date.now(), input, output }]
      .filter((entry) => entry.at >= cutoff)
      .slice(-500)

    void get().patchSettings({ usageLog: log.slice(0, 120), usagePulse: pulse })
  },

  notify: (body) => {
    void (async () => {
      try {
        const { isPermissionGranted, requestPermission, sendNotification } = await import(
          '@tauri-apps/plugin-notification'
        )
        const granted = (await isPermissionGranted()) || (await requestPermission()) === 'granted'
        if (granted) sendNotification({ title: 'jStudio', body })
        else get().toast(body, 'ok')
      } catch {
        get().toast(body, 'ok')
      }
    })()
  },

  resetSpoof: () =>
    set({ spoofItems: [], spoofProgress: { total: 0, done: 0, failed: 0 }, spoofStatus: '' }),

  lookForUpdate: async () => set({ updateVersion: await checkUpdate() }),

  bootstrap: async () => {
    const stored = await config.load()
    const settings = {
      ...stored,
      skills: mergeSkills(stored.skills),
      agents: mergeAgents(stored.agents),
      memory: {
        ...stored.memory,
        items: stored.memory.items.filter(
          (entry, index, list) => list.findIndex((other) => other.id === entry.id) === index
        ),
      },
      studioMcpEnabled: true,
      contextLimit: stored.contextLimit === 1_000_000 ? 500_000 : stored.contextLimit,
    }
    paintTheme(settings.theme)

    if (!settings.languagePicked) settings.language = systemLanguage()

    set({ settings, apiKey: await secrets.get(`apiKey.${settings.providerId}`) })

    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (get().settings.theme === 'system') paintTheme('system')
      })

    await Promise.all([
      get().refreshStatus(),
      get().refreshTree(),
      get().refreshAccounts(),
      get().refreshRuns(),
      conversationsApi.load().then((conversations) => set({ conversations })),
    ])

    if (!settings.model) {
      const fallback = findProvider(settings.providerId).fallbackModels[0]
      if (fallback) await get().patchSettings({ model: fallback })
    }

    if (!settings.onboarded && (get().aiReady() || get().robloxReady())) {
      await get().patchSettings({
        onboarded: true,
        intent: [
          ...(get().aiReady() ? (['build'] as const) : []),
          ...(get().robloxReady() ? (['animations'] as const) : []),
        ],
      })
    }

    await listen<BridgeStatus>('studio:status', (payload) => {
      const next = bridgeStatusSchema.parse(payload)
      const wasOffline = !get().status.online
      set({ status: next })

      if (next.online && wasOffline && get().settings.studioMcpEnabled && !get().studioMcpReady()) {
        void get().reconnectMcp()
      }
    })
    await listen<BridgeStatus>('studio:tree', (payload) => {
      set({ status: bridgeStatusSchema.parse(payload) })
      void get().refreshTree()
    })
    await listen<{ count: number }>('studio:selection', ({ count }) =>
      set((state) => ({ status: { ...state.status, selectionCount: count } }))
    )
    await listen<{ text: string }>('spoof:status', ({ text }) => set({ spoofStatus: text }))
    await listen<{ total: number; done: number; failed: number }>('spoof:progress', (progress) =>
      set({ spoofProgress: progress })
    )
    await listen<SpoofItem>('spoof:item', (item) =>
      set((state) => {
        const index = state.spoofItems.findIndex((entry) => entry.id === item.id)
        if (index === -1) return { spoofItems: [...state.spoofItems, item] }

        const next = [...state.spoofItems]
        next[index] = item
        return { spoofItems: next }
      })
    )

    await get().reconnectMcp()
    void get().lookForUpdate()
    set({ ready: true })
    setTimeout(() => set({ booted: true }), 600)
  },
}))
