import type { Action, RunRecord, SpoofOptions } from '@/app/lib/schemas'
import {
  accountList,
  bridgeStatus,
  conversation,
  pluginStatus,
  runRecord,
  settings as settingsSchema,
  type Account,
  type BridgeStatus,
  type Conversation,
  type PluginStatus,
  type Settings,
} from '@/app/lib/schemas'

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) throw new Error('This action needs the jStudio desktop window.')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!isDesktop()) return () => {}
  const { listen: subscribe } = await import('@tauri-apps/api/event')
  const stop = await subscribe<T>(event, (message) => handler(message.payload))
  return stop
}

export async function net(url: string, init?: RequestInit): Promise<Response> {
  if (!isDesktop()) return fetch(url, init)
  const { fetch: desktopFetch } = await import('@tauri-apps/plugin-http')
  return desktopFetch(url, init)
}

export async function openExternal(url: string): Promise<void> {
  if (!isDesktop()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}

const offlineStatus = bridgeStatus.parse({})

export const studio = {
  status: async (): Promise<BridgeStatus> =>
    isDesktop() ? bridgeStatus.parse(await call('bridgeStatus')) : offlineStatus,
  tree: async () => {
    if (!isDesktop()) return { nodes: [], truncated: false, syncedAt: null }
    return call<{ nodes: { path: string; className: string; source?: string }[]; truncated: boolean; syncedAt: number | null }>(
      'bridgeTree'
    )
  },
  enqueue: (action: Action) =>
    call<string>('bridgeEnqueue', { kind: action.kind, payload: action }),
  result: (id: string) =>
    call<{ id: string; status: 'done' | 'error'; message: string; at: number } | null>('bridgeResult', { id }),
}

export const plugin = {
  status: async (): Promise<PluginStatus> =>
    isDesktop() ? pluginStatus.parse(await call('pluginStatus')) : pluginStatus.parse({}),
  install: () => call<string>('pluginInstall'),
}

export const secrets = {
  set: (id: string, value: string) => call<void>('secretSet', { id, value }),
  get: async (id: string) => (isDesktop() ? ((await call<string | null>('secretGet', { id })) ?? '') : ''),
}

export const config = {
  load: async (): Promise<Settings> => {
    if (!isDesktop()) return settingsSchema.parse({})
    const parsed = settingsSchema.safeParse(await call('settingsLoad'))
    return parsed.success ? parsed.data : settingsSchema.parse({})
  },
  save: (value: Settings) => call<void>('settingsSave', { value }),
}

const parseAccounts = (value: unknown) => accountList.parse(value)

export const accounts = {
  list: async () => (isDesktop() ? parseAccounts(await call('accountsList')) : parseAccounts({})),
  signIn: async () => parseAccounts(await call('accountSignIn')),
  signInWithCookie: async (cookie: string) =>
    parseAccounts(await call('accountSignInWithCookie', { cookie })),
  setApiKey: async (id: string, apiKey: string) =>
    parseAccounts(await call('accountSetApiKey', { id, apiKey })),
  setActive: async (id: string) => parseAccounts(await call('accountSetActive', { id })),
  remove: async (id: string) => parseAccounts(await call('accountRemove', { id })),
  groups: () => call<{ id: string; name: string }[]>('accountGroups'),
  probeApiKey: (apiKey: string) =>
    call<{ verdict: 'ok' | 'empty' | 'unauthorized' | 'forbidden' | 'unknown' }>('accountProbeApiKey', {
      apiKey,
    }),
}

export type SpoofResult = { ok: boolean; stopped: boolean; done: number; failed: number; run: RunRecord }

export const spoof = {
  scan: (selectedOnly: boolean) => call<{ id: string; name: string }[]>('spoofScan', { selectedOnly }),
  start: (options: SpoofOptions) => call<SpoofResult>('spoofStart', { options }),
  pause: () => call<void>('spoofPause'),
  resume: () => call<void>('spoofResume'),
  stop: () => call<void>('spoofStop'),
}

const parseRuns = (value: unknown): RunRecord[] => {
  const parsed = Array.isArray(value) ? value : []
  return parsed.flatMap((entry) => {
    const run = runRecord.safeParse(entry)
    return run.success ? [run.data] : []
  })
}

export const history = {
  runs: async () => (isDesktop() ? parseRuns(await call('runsLoad')) : []),
  apply: (id: string, revert: boolean) =>
    call<{ count: number; applied: boolean }>('runApply', { id, revert }),
  patch: async (id: string, patch: { label?: string; pinned?: boolean; archived?: boolean }) =>
    parseRuns(await call('runPatch', { id, patch })),
  remove: async (id: string) => parseRuns(await call('runDelete', { id })),
  clear: () => call<void>('historyClear'),
}

const parseConversations = (value: unknown): Conversation[] => {
  const list = Array.isArray(value) ? value : []
  return list.flatMap((entry) => {
    const parsed = conversation.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

export const conversations = {
  load: async () => (isDesktop() ? parseConversations(await call('conversationsLoad')) : []),
  save: async (value: Conversation) => parseConversations(await call('conversationSave', { conversation: value })),
  remove: async (id: string) => parseConversations(await call('conversationDelete', { id })),
}

export type McpToolDescriptor = { name: string; description?: string; inputSchema?: Record<string, unknown> }

export const mcpHost = {
  detectStudio: () => call<{ available: boolean; command: string; args: string[] }>('mcpDetectStudio'),
  connect: (id: string, command: string, args: string[]) =>
    call<{ id: string; tools: McpToolDescriptor[] }>('mcpConnect', { id, command, args }),
  disconnect: (id: string) => call<void>('mcpDisconnect', { id }),
  callTool: (id: string, name: string, args: Record<string, unknown>) =>
    call<string>('mcpCall', { id, name, args }),
}

export async function pickFolder(): Promise<string | null> {
  if (!isDesktop()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const chosen = await open({ directory: true, multiple: false })
  return typeof chosen === 'string' ? chosen : null
}

export const appWindow = {
  minimize: async () => {
    if (!isDesktop()) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().minimize()
  },
  toggleMaximize: async () => {
    if (!isDesktop()) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().toggleMaximize()
  },
  close: async () => {
    if (!isDesktop()) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().close()
  },
}

export type { Account }
