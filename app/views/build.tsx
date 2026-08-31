'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { runAgent, type AgentEvent } from '@/app/lib/agent'
import { applyAction, studioMcp } from '@/app/lib/apply'
import { describeError, groupModels, isFreeModel, resolveEndpoint, streamChat, type Endpoint } from '@/app/lib/llm'
import { spoof as spoofApi } from '@/app/lib/ipc'
import { findProvider } from '@/app/lib/providers'
import { play } from '@/app/lib/sfx'
import { useStore } from '@/app/lib/state'
import {
  spoofOptions,
  type Action,
  type AgentStep,
  type ChatMessage,
  type Conversation,
  type Skill,
} from '@/app/lib/schemas'
import {
  Badge,
  Button,
  Confirm,
  Dropdown,
  EmptyState,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  Popover,
  Ring,
  Skeleton,
  Spinner,
  anchorFrom,
  cx,
  type Anchor,
} from '@/app/ui/primitives'
import type { MessageKey } from '@/app/lib/i18n'

type Bubble = ChatMessage & { streaming?: boolean }
type ActionState = 'pending' | 'applying' | 'applied' | 'failed'
type Outgoing = { text: string; images: string[]; forced: string[] }

const newId = () => `chat${Date.now()}`
const MAX_IMAGES = 4
const DAY = 86_400_000

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

const commands: { name: string; hint: MessageKey }[] = [{ name: 'compress', hint: 'build.compressHint' }]

const bubble = (role: 'user' | 'assistant', content: string, images: string[] = []): Bubble => ({
  role,
  content,
  actions: [],
  reasoning: '',
  steps: [],
  images,
  at: Date.now(),
  variants: [],
  variant: 0,
  artifacts: [],
  questions: [],
  resolved: false,
  folded: false,
  plan: null,
  memories: [],
})

const steps: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60_000],
  ['minute', 3_600_000],
  ['hour', DAY],
  ['day', DAY * 7],
]

function ago(value: number, language: string): string {
  if (!value) return ''

  const distance = value - Date.now()
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  let previous = 1000

  for (const [unit, limit] of steps) {
    if (Math.abs(distance) < limit) return format.format(Math.round(distance / previous), unit)
    previous = limit
  }

  return new Date(value).toLocaleDateString()
}

/** Token counts read at a glance: 892, 8k, 9.5k, 990.5k, 1M. No trailing .0, and k rolls into M. */
function compact(value: number): string {
  const trim = (scaled: number) => String(Math.round(scaled * 10) / 10)

  if (value >= 999_950) return `${trim(value / 1_000_000)}M`
  if (value >= 1000) return `${trim(value / 1000)}k`
  return String(value)
}

/**
 * Naming runs on the same provider but never on the same reasoning budget: a thinking model spends
 * its whole allowance before the first visible token, and the old fifteen second cap turned every
 * such run into the fallback, which is why chats ended up named after the message.
 */
async function generateTitle(endpoint: Endpoint, prompt: string): Promise<string> {
  const fallback = prompt.trim().replace(/\s+/g, ' ').slice(0, 24)

  try {
    let text = ''
    const stream = streamChat(
      { ...endpoint, effort: 'low', temperature: 0.3 },
      [
        {
          role: 'system',
          content:
            'Name this request in two words, three at the very most, in the language it is written in. Name the subject, not the action. Answer with the name alone, no quotes and no period.',
        },
        { role: 'user', content: prompt.slice(0, 500) },
      ],
      [],
      AbortSignal.timeout(45_000)
    )

    for await (const delta of stream) if (delta.type === 'text') text += delta.text

    const title = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .split('\n')
      .map((line) => line.replace(/^[-*\d.\s]+/, '').replace(/["'.`]/g, '').trim())
      .filter(Boolean)
      .pop()

    return title && title.length > 2 ? title.slice(0, 24) : fallback
  } catch {
    return fallback
  }
}

async function advise(
  endpoint: Endpoint,
  role: string,
  question: string,
  signal: AbortSignal,
  onDelta?: (text: string) => void
): Promise<string> {
  try {
    let text = ''
    const stream = streamChat(
      endpoint,
      [
        {
          role: 'system',
          content: `${role}

Answer the question you are given, in the language it is written in. At most six short lines, each one a concrete
point. No preamble, no closing remark, no restating the question.`,
        },
        { role: 'user', content: question.slice(0, 4000) },
      ],
      [],
      signal
    )

    for await (const delta of stream) {
      if (delta.type !== 'text') continue
      text += delta.text
      onDelta?.(delta.text)
    }
    return text.trim()
  } catch {
    return ''
  }
}

function complete(draft: string, name: string): string {
  return draft.replace(/(?:^|\s)\/[a-z0-9-]*$/i, (match) => `${match.startsWith('/') ? '' : ' '}/${name} `)
}

function highlight(draft: string, skills: Skill[]): ReactNode[] {
  const names = [...commands.map((entry) => entry.name), ...skills.map((entry) => entry.name)]
  if (names.length === 0) return [draft]

  const pattern = new RegExp(`/(?:${names.join('|')})\\b`, 'gi')
  const parts: ReactNode[] = []
  let cursor = 0

  for (const match of draft.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > cursor) parts.push(draft.slice(cursor, at))
    parts.push(
      <span key={at} className="rounded bg-accent-soft">
        {match[0]}
      </span>
    )
    cursor = at + match[0].length
  }

  parts.push(draft.slice(cursor))
  return parts
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that image.'))
    reader.readAsDataURL(file)
  })
}

function appendSegment(steps: AgentStep[], kind: 'thought' | 'text', text: string): AgentStep[] {
  const last = steps[steps.length - 1]
  if (last?.kind === kind) return [...steps.slice(0, -1), { ...last, text: last.text + text }]
  return [...steps, { kind, id: '', status: 'done', name: '', target: '', source: '', text }]
}

function bucketOf(value: number): MessageKey {
  const age = Date.now() - value
  if (age < DAY) return 'chat.today'
  if (age < DAY * 2) return 'chat.yesterday'
  if (age < DAY * 7) return 'chat.week'
  return 'chat.older'
}

export function BuildView() {
  const store = useStore()
  const { settings, apiKey, nodes, truncated, status, mcp, conversations, t } = store

  const [conversationId, setConversationId] = useState(newId)
  const [messages, setMessages] = useState<Bubble[]>([])
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [runningChat, setRunningChat] = useState<string | null>(null)
  const [queue, setQueue] = useState<Outgoing[]>([])
  const [usage, setUsage] = useState({ input: 0, output: 0 })
  const usageRef = useRef(usage)
  const [states, setStates] = useState<Record<string, ActionState>>({})
  const [showArchived, setShowArchived] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [forking, setForking] = useState<number | null>(null)
  const [compressing, setCompressing] = useState(false)

  const abort = useRef<AbortController | null>(null)
  const conversationIdRef = useRef(conversationId)
  const bottom = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const listRef = useRef<Bubble[]>([])
  const runningRef = useRef(false)
  const savedAt = useRef(0)
  // A run belongs to the conversation it started in, not to whichever one happens to be on screen,
  // so leaving a chat mid answer neither kills it nor spills its messages into the next one.
  const runningIn = useRef<string | null>(null)
  const parked = useRef(new Map<string, Bubble[]>())
  const queues = useRef(new Map<string, Outgoing[]>())
  const usages = useRef(new Map<string, { input: number; output: number }>())
  const known = useRef(new Set<string>())
  const discarded = useRef(new Set<string>())

  const provider = findProvider(settings.providerId)

  const endpoint = useMemo(
    () =>
      resolveEndpoint({
        providerId: settings.providerId,
        customBaseUrl: settings.customBaseUrl,
        apiKey,
        model: settings.model,
        temperature: settings.temperature,
        effort: settings.effort,
      }),
    [settings.providerId, settings.customBaseUrl, apiKey, settings.model, settings.temperature, settings.effort]
  )

  /**
   * The messages of any conversation: the live list when it is on screen, the parked copy while a
   * run writes to it in the background, and the saved copy otherwise.
   */
  const listOf = useCallback((id: string): Bubble[] => {
    if (id === conversationIdRef.current) return listRef.current
    return (
      parked.current.get(id) ??
      useStore.getState().conversations.find((entry) => entry.id === id)?.messages ??
      []
    )
  }, [])

  const commitTo = useCallback((id: string, next: Bubble[]) => {
    if (id === conversationIdRef.current) {
      listRef.current = next
      setMessages(next)
      return
    }
    parked.current.set(id, next)
  }, [])

  const commit = useCallback(
    (next: Bubble[]) => commitTo(conversationIdRef.current, next),
    [commitTo]
  )

  const persistTo = useCallback(
    (id: string, title?: string) => {
      // A conversation deleted mid answer must not be written back by the run still finishing it.
      if (discarded.current.has(id)) return

      const list = listOf(id)
      const existing = useStore.getState().conversations.find((entry) => entry.id === id)
      const first = list.find((entry) => entry.role === 'user')?.content ?? 'Chat'

      void useStore.getState().saveConversation({
        id,
        title: title ?? existing?.title ?? first.slice(0, 40),
        updatedAt: Date.now(),
        pinned: existing?.pinned ?? false,
        archived: existing?.archived ?? false,
        messages: list.map(({ streaming: _streaming, ...rest }) => rest),
      })
    },
    [listOf]
  )

  const persist = useCallback(
    (title?: string) => persistTo(conversationIdRef.current, title),
    [persistTo]
  )

  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /** Hands the visible chat over to the background and brings the target one forward. */
  const switchTo = useCallback(
    (id: string, messages: Bubble[] | null) => {
      const leaving = conversationIdRef.current
      if (leaving === id) return

      if (runningIn.current === leaving) parked.current.set(leaving, listRef.current)
      usages.current.set(leaving, usageRef.current)

      conversationIdRef.current = id
      setConversationId(id)

      const restored = parked.current.get(id) ?? messages ?? []
      if (runningIn.current !== id) parked.current.delete(id)

      listRef.current = restored
      setMessages(restored)

      const usage = usages.current.get(id) ?? { input: 0, output: 0 }
      usageRef.current = usage
      setUsage(usage)

      setQueue([...(queues.current.get(id) ?? [])])
      setBusy(runningIn.current === id)
      setStates({})
      setImages([])
    },
    []
  )

  const startNewChat = useCallback(() => {
    switchTo(newId(), [])
  }, [switchTo])

  const openChat = useCallback(
    (conversation: Conversation) => {
      if (conversation.id === conversationIdRef.current) return
      switchTo(conversation.id, conversation.messages)
      useStore.getState().visitChat(conversation.id)
    },
    [switchTo]
  )

  useEffect(() => {
    const ids = new Set(conversations.map((entry) => entry.id))

    // A run keeps writing to the chat it belongs to, so deleting that chat has to stop it, or the
    // next save would bring the deleted conversation back.
    const running = runningIn.current
    if (running && known.current.has(running) && !ids.has(running)) {
      discarded.current.add(running)
      abort.current?.abort()
    }

    known.current = ids

    const live = new Set([...ids, conversationIdRef.current, ...(running ? [running] : [])])
    for (const store of [parked.current, queues.current, usages.current]) {
      for (const id of store.keys()) if (!live.has(id)) store.delete(id)
    }
  }, [conversations])

  useEffect(() => {
    const onNew = () => startNewChat()
    const onOpen = (event: Event) => openChat((event as CustomEvent<Conversation>).detail)
    const onModel = () => setModelOpen(true)

    window.addEventListener('jstudio:newChat', onNew)
    window.addEventListener('jstudio:openChat', onOpen)
    window.addEventListener('jstudio:pickModel', onModel)
    return () => {
      window.removeEventListener('jstudio:newChat', onNew)
      window.removeEventListener('jstudio:openChat', onOpen)
      window.removeEventListener('jstudio:pickModel', onModel)
    }
  }, [startNewChat, openChat])

  const apply = useCallback(async (action: Action, key: string) => {
    setStates((current) => ({ ...current, [key]: 'applying' }))

    const state = useStore.getState()
    const result = await applyAction(action, state.mcp, state.status.online)
    setStates((current) => ({ ...current, [key]: result.ok ? 'applied' : 'failed' }))

    play(result.ok ? 'done' : 'error', state.settings.sounds)
    if (!result.ok) state.toast(result.message, 'danger')
    await state.refreshTree()
  }, [])

  const addImages = async (files: FileList | File[]) => {
    const picked = [...files].filter((file) => file.type.startsWith('image/')).slice(0, MAX_IMAGES)
    const encoded = await Promise.all(picked.map(readImage))
    setImages((current) => [...current, ...encoded].slice(0, MAX_IMAGES))
  }

  const run = useCallback(
    async (history: Bubble[], forcedIds: string[], conversation?: string) => {
      if (runningRef.current) {
        useStore.getState().toast(t('build.oneAtATime'))
        return
      }
      const target = conversation ?? conversationIdRef.current

      runningRef.current = true
      runningIn.current = target
      setRunningChat(target)

      commitTo(target, [...history, { ...bubble('assistant', ''), streaming: true }])
      if (target === conversationIdRef.current) setBusy(true)

      const controller = new AbortController()
      abort.current = controller

      const update = (patch: (entry: Bubble) => Bubble) => {
        const current = listOf(target)
        const last = current[current.length - 1]
        if (!last) return
        commitTo(target, [...current.slice(0, -1), patch(last)])

        if (Date.now() - savedAt.current > 1500) {
          savedAt.current = Date.now()
          persistTo(target)
        }
      }

      try {
        const stream = runAgent({
          endpoint,
          history: history
            .filter((entry) => !entry.folded)
            .map(({ role, content, images: attached }) => ({ role, content, images: attached })),
          nodes,
          truncated,
          skills: settings.skills.filter((entry) => entry.enabled),
          forcedSkills: settings.skills.filter((entry) => forcedIds.includes(entry.id)),
          offered: settings.skills.filter((entry) => !entry.enabled && !forcedIds.includes(entry.id)),
          plan: settings.mode === 'plan',
          instructions: settings.customInstructions,
          memories: settings.memory.enabled ? settings.memory.items.map((entry) => entry.text) : [],
          references: settings.useChatHistory
            ? conversations
                .filter((entry) => entry.id !== conversationId && entry.messages.length > 0)
                .slice(0, 8)
                .map((entry) => `${entry.title}: ${entry.messages[0]?.content.slice(0, 160) ?? ''}`)
            : [],
          agents: settings.agents
            .filter((agent) => agent.enabled)
            .slice(0, 3)
            .map((agent) => ({
              name: agent.name,
              model: agent.model || endpoint.model,
              instructions: agent.instructions,
            })),
          delegate: async (agent, task) => {
            let at = -1
            update((entry) => {
              at = entry.steps.length
              return {
                ...entry,
                steps: [
                  ...entry.steps,
                  {
                    kind: 'artifact',
                    id: '',
                    status: 'done',
                    name: agent.name,
                    target: task,
                    source: agent.model,
                    text: '',
                  },
                ],
              }
            })

            const note = await advise(
              { ...endpoint, model: agent.model },
              agent.instructions,
              task,
              controller.signal,
              (delta) =>
                update((entry) => ({
                  ...entry,
                  steps: entry.steps.map((step, index) =>
                    index === at ? { ...step, text: step.text + delta } : step
                  ),
                }))
            )

            if (!note) {
              update((entry) => ({
                ...entry,
                steps: entry.steps.map((step, index) =>
                  index === at ? { ...step, text: t('build.agentEmpty') } : step
                ),
              }))
            }

            return note
          },
          mcp,
          canEditPlace: !!studioMcp(mcp) || status.online,
          maxTurns: settings.maxTurns,
          signal: controller.signal,
          animations: {
            respoof: async (options) => {
              store.resetSpoof()
              const parsed = spoofOptions.parse({ ...settings.spoof, ...options })
              const result = await spoofApi.start(parsed)
              await store.refreshRuns()
              return `The run finished with ${result.done} animation(s) replaced and ${result.failed} failure(s).`
            },
          },
        })

        for await (const event of stream as AsyncGenerator<AgentEvent>) {
          if (event.type === 'text')
            update((entry) => ({
              ...entry,
              content: entry.content + event.text,
              steps: appendSegment(entry.steps, 'text', event.text),
            }))
          else if (event.type === 'reasoning')
            update((entry) => ({ ...entry, steps: appendSegment(entry.steps, 'thought', event.text) }))
          else if (event.type === 'toolStart')
            update((entry) => ({
              ...entry,
              steps: [
                ...entry.steps,
                {
                  kind: 'tool',
                  id: event.id,
                  status: 'running',
                  name: event.name,
                  target: event.target,
                  source: event.source,
                  text: '',
                },
              ],
            }))
          else if (event.type === 'toolEnd')
            update((entry) => ({
              ...entry,
              steps: entry.steps.map((step) =>
                step.id === event.id ? { ...step, status: event.ok ? 'done' : 'failed' } : step
              ),
            }))
          else if (event.type === 'action') {
            update((entry) => ({ ...entry, actions: [...entry.actions, event.action] }))
            if (settings.mode === 'auto') {
              const index = listOf(target).length - 1
              const position = (listOf(target)[index]?.actions.length ?? 1) - 1
              void apply(event.action, `${index}:${position}`)
            }
          }
          else if (event.type === 'question')
            update((entry) => ({ ...entry, questions: event.questions }))
          else if (event.type === 'plan')
            update((entry) => ({ ...entry, plan: { title: event.title, steps: event.steps } }))
          else if (event.type === 'remember') {
            for (const fact of event.facts) store.rememberFact(fact)
            update((entry) => ({
              ...entry,
              steps: [
                ...entry.steps,
                ...event.facts.map((fact) => ({
                  kind: 'memory' as const,
                  id: '',
                  status: 'done' as const,
                  name: '',
                  target: '',
                  source: '',
                  text: fact,
                })),
              ],
            }))
          }
          else if (event.type === 'usage') {
            const banked = usages.current.get(target) ?? { input: 0, output: 0 }
            const next = {
              input: banked.input + event.inputTokens,
              output: banked.output + event.outputTokens,
            }
            usages.current.set(target, next)
            if (target === conversationIdRef.current) {
              usageRef.current = next
              setUsage(next)
            }
            store.recordUsage(event.inputTokens, event.outputTokens)
          }
        }
        play('done', settings.sounds)
        if (
          !document.hasFocus() ||
          useStore.getState().view !== 'build' ||
          target !== conversationIdRef.current
        ) {
          store.notify(t('build.finished'))
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          update((entry) => ({ ...entry, content: entry.content || describeError(error, provider) }))
          play('error', settings.sounds)
        }
      } finally {
        // A stop or a failure leaves the call it was on unresolved, and a step that never settles
        // would spin for the life of the conversation.
        update((entry) => ({
          ...entry,
          streaming: false,
          at: Date.now(),
          steps: entry.steps.map((step) =>
            step.status === 'running' ? { ...step, status: 'failed' as const } : step
          ),
        }))
        if (target === conversationIdRef.current) setBusy(false)
        abort.current = null
        runningRef.current = false
        runningIn.current = null
        setRunningChat(null)
      }

      const dropped = discarded.current.delete(target)
      if (dropped) {
        parked.current.delete(target)
        queues.current.delete(target)
        usages.current.delete(target)
      } else {
        const first = history.find((entry) => entry.role === 'user')?.content ?? 'Chat'
        const existing = useStore.getState().conversations.find((entry) => entry.id === target)
        persistTo(target, existing?.title ?? (await generateTitle(endpoint, first)))
      }

      // The chat that was running gets its own backlog first; a message typed into another chat
      // while it worked starts as soon as this one is out of the way.
      const pending =
        !dropped && (queues.current.get(target)?.length ?? 0) > 0
          ? target
          : [...queues.current.entries()].find(([, items]) => items.length > 0)?.[0]

      if (!pending) return
      const items = queues.current.get(pending) ?? []
      const next = items.shift()
      queues.current.set(pending, items)
      if (pending === conversationIdRef.current) setQueue([...items])

      if (next) {
        await run([...listOf(pending), bubble('user', next.text, next.images)], next.forced, pending)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint, nodes, truncated, settings, mcp, status.online, provider, t, commitTo, listOf, apply, persistTo]
  )

  const typing = /(?:^|\s)\/([a-z0-9-]*)$/i.exec(draft)?.[1]
  const slashMatches =
    typing === undefined
      ? []
      : settings.skills.filter((entry) => entry.name.toLowerCase().includes(typing.toLowerCase()))

  const mentioned = settings.skills.filter((entry) =>
    new RegExp(`(?:^|\\s)/${entry.name}\\b`, 'i').test(draft)
  )

  const commandMatches =
    typing === undefined ? [] : commands.filter((entry) => entry.name.startsWith(typing.toLowerCase()))

  const jump = () => {
    stick.current = true
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const compress = useCallback(
    async (focus: string, label: string) => {
      if (compressing || runningRef.current) return
      setCompressing(true)

      const transcript = listRef.current
        .map((entry) => `${entry.role === 'user' ? 'Person' : 'You'}: ${entry.content}`)
        .join('\n\n')
        .slice(-40_000)

      commit([...listRef.current, bubble('user', label), { ...bubble('assistant', ''), streaming: true }])

      const update = (patch: (entry: Bubble) => Bubble) => {
        const current = listRef.current
        const last = current[current.length - 1]
        if (!last) return
        commit([...current.slice(0, -1), patch(last)])
      }

      try {
        const stream = streamChat(
          endpoint,
          [
            {
              role: 'system',
              content: [
                'Summarise this conversation so it can carry on without the original messages.',
                'Keep what was decided, what was built, the paths that were touched, the constraints and what is still open.',
                'Write it as notes, in the language of the conversation. No greeting, no closing line.',
                focus ? `Pay attention to: ${focus}` : '',
              ]
                .filter(Boolean)
                .join(' '),
            },
            { role: 'user', content: transcript },
          ],
          [],
          AbortSignal.timeout(120_000)
        )

        for await (const delta of stream) {
          if (delta.type !== 'text') continue
          update((entry) => ({
            ...entry,
            content: entry.content + delta.text,
            steps: appendSegment(entry.steps, 'text', delta.text),
          }))
        }

        const current = listRef.current
        const summary = current[current.length - 1]
        const command = current[current.length - 2]

        if (summary && command) {
          commit([
            ...current.slice(0, -2).map((entry) => ({ ...entry, folded: true })),
            command,
            { ...summary, streaming: false, at: Date.now() },
          ])
        }

        const cleared = { input: 0, output: 0 }
        usages.current.set(conversationIdRef.current, cleared)
        usageRef.current = cleared
        setUsage(cleared)
        play('done', settings.sounds)
        persist()
      } catch (error) {
        update((entry) => ({ ...entry, streaming: false, content: describeError(error, provider) }))
        play('error', settings.sounds)
      } finally {
        setCompressing(false)
      }
    },
    [endpoint, compressing, commit, persist, provider, settings.sounds]
  )

  const command = (text: string): boolean => {
    const match = /^\/compress\b\s*(.*)$/is.exec(text)
    if (!match) return false

    void compress((match[1] ?? '').trim(), text)
    return true
  }

  const send = useCallback(() => {
    const text = draft.trim()
    if (!text && images.length === 0) return

    if (command(text)) {
      setDraft('')
      return
    }

    const open = listRef.current.length - 1
    const waiting = listRef.current[open]
    if (waiting && !waiting.resolved && (waiting.plan || waiting.questions.length > 0)) {
      commit(
        listRef.current.map((entry, position) => (position === open ? { ...entry, resolved: true } : entry))
      )
    }

    const payload = { text, images, forced: mentioned.map((entry) => entry.id) }
    setDraft('')
    setImages([])
    play('send', settings.sounds)
    jump()

    if (runningRef.current) {
      const here = conversationIdRef.current
      const items = [...(queues.current.get(here) ?? []), payload]
      queues.current.set(here, items)
      setQueue(items)
      return
    }

    void run([...listRef.current, bubble('user', payload.text, payload.images)], payload.forced)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, images, mentioned, run, settings.sounds])

  const editMessage = (index: number, text: string) => {
    const target = listRef.current[index]
    if (!target) return

    const variants = [...(target.variants.length ? target.variants : [target.content]), text]
    const edited: Bubble = { ...target, content: text, at: Date.now(), variants, variant: variants.length - 1 }
    void run([...listRef.current.slice(0, index), edited], [])
  }

  const answer = (text: string, index?: number) => {
    const current =
      index === undefined
        ? listRef.current
        : listRef.current.map((entry, position) =>
            position === index ? { ...entry, resolved: true } : entry
          )

    void run([...current, bubble('user', text)], [])
  }

  const resolveAt = (index: number) => {
    commit(listRef.current.map((entry, position) => (position === index ? { ...entry, resolved: true } : entry)))
    persist()
  }

  const approvePlan = (index: number) => {
    if (settings.mode === 'plan') void store.patchSettings({ mode: 'manual' })
    answer(t('build.planApproved'), index)
  }

  const regenerate = () => {
    const last = listRef.current[listRef.current.length - 1]
    if (!last || last.role !== 'assistant') return
    void run(listRef.current.slice(0, -1), [])
  }

  const fork = (index: number) => {
    const slice = listRef.current.slice(0, index + 1)
    const id = newId()
    const source = conversations.find((entry) => entry.id === conversationId)

    void store.saveConversation({
      id,
      title: t('build.forkOf', { title: source?.title ?? t('build.newChat') }).slice(0, 40),
      updatedAt: Date.now(),
      pinned: false,
      archived: false,
      messages: slice.map(({ streaming: _streaming, ...rest }) => rest),
    })
    switchTo(id, slice)
    store.toast(t('build.forked'), 'ok')
  }

  const visible = conversations.filter((entry) => !entry.archived)
  const pinned = visible.filter((entry) => entry.pinned)
  const loose = visible.filter((entry) => !entry.pinned)
  const archived = conversations.filter((entry) => entry.archived)

  const slices: Slice[] = [
    {
      label: t('build.sliceMessages'),
      tokens: messages
        .filter((entry) => !entry.folded)
        .reduce((sum, entry) => sum + estimate(entry.content), 0),
      className: 'bg-accent',
    },
    {
      label: t('build.slicePlace'),
      tokens: nodes.reduce((sum, node) => sum + estimate(node.path + (node.source ?? '')), 0),
      className: 'bg-accent/60',
    },
    {
      label: t('build.sliceTools'),
      tokens:
        1200 +
        mcp.reduce(
          (sum, connection) =>
            sum +
            connection.tools.reduce(
              (inner, tool) => inner + estimate(tool.name + (tool.description ?? '')),
              0
            ),
          0
        ),
      className: 'bg-ok',
    },
    {
      label: t('build.sliceSkills'),
      tokens: settings.skills
        .filter((entry) => entry.enabled)
        .reduce((sum, entry) => sum + estimate(entry.instructions), 0),
      className: 'bg-warn',
    },
    {
      label: t('build.sliceMemory'),
      tokens:
        estimate(settings.customInstructions) +
        settings.memory.items.reduce((sum, entry) => sum + estimate(entry.text), 0),
      className: 'bg-danger/70',
    },
  ]

  const last = messages[messages.length - 1]
  const pending =
    last && !last.streaming && !last.resolved && (last.plan || last.questions.length > 0)
      ? { message: last, index: messages.length - 1 }
      : null

  const buckets: { key: MessageKey; items: Conversation[] }[] = (
    ['chat.today', 'chat.yesterday', 'chat.week', 'chat.older'] as MessageKey[]
  ).map((key) => ({ key, items: loose.filter((entry) => bucketOf(entry.updatedAt) === key) }))

  return (
    <div className="flex h-full">
      <aside className="flex w-[252px] shrink-0 flex-col border-r border-line bg-surface">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
          <h2 className="text-sm font-semibold">{t('build.conversations')}</h2>
          <IconButton icon="plus" title={t('build.newChat')} onClick={startNewChat} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!store.ready ? (
            <div className="space-y-1.5 p-1">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : (
            <>
              <ChatGroup
                label={t('chat.pinned')}
                items={pinned}
                current={conversationId}
                running={runningChat}
                onOpen={openChat}
                onNew={startNewChat}
              />
              {buckets.map((group) => (
                <ChatGroup
                  key={group.key}
                  label={t(group.key)}
                  items={group.items}
                  current={conversationId}
                  running={runningChat}
                  onOpen={openChat}
                  onNew={startNewChat}
                />
              ))}

              {archived.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowArchived(!showArchived)}
                    className="flex w-full items-center gap-1.5 px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-faint transition-colors hover:text-dim"
                  >
                    <Icon name="chevron" className={cx('size-3 transition-transform', showArchived && 'rotate-90')} />
                    {t('chat.archived')}
                  </button>
                  {showArchived ? (
                    <ChatGroup
                      label=""
                      items={archived}
                      current={conversationId}
                      running={runningChat}
                      onOpen={openChat}
                      onNew={startNewChat}
                    />
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line px-5">
          <h1 className="text-sm font-semibold">{t('nav.build')}</h1>
          {status.online ? null : <span className="text-[13px] text-faint">{t('build.needsStudio')}</span>}
        </header>

        <div
          ref={scroller}
          onScroll={() => {
            const node = scroller.current
            if (node) stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-7 px-6 py-8">
            {messages.length === 0 ? (
              <EmptyState icon="build" title={t('build.emptyTitle')} body={t('build.emptyBody')} />
            ) : (
              messages.map((message, index) => (
                <Fragment key={index}>
                  {message.folded && !messages[index + 1]?.folded ? (
                    <p className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-faint">
                      <span className="h-px flex-1 bg-line" />
                      {t('build.folded')}
                      <span className="h-px flex-1 bg-line" />
                    </p>
                  ) : null}

                  <Message
                  key={index}
                  message={message}
                  index={index}
                  last={index === messages.length - 1}
                  states={states}
                  canApply={status.online}
                  showReasoning={settings.showReasoning}
                  onApply={(action, position) => void apply(action, `${index}:${position}`)}
                  onEdit={(text) => editMessage(index, text)}
                  onRegenerate={regenerate}
                    onFork={() => setForking(index)}
                  />
                </Fragment>
              ))
            )}

            {queue.map((entry, index) => (
              <div key={index} className="flex justify-end">
                <p className="max-w-[85%] rounded-[var(--radius-panel)] border border-dashed border-line px-4 py-2.5 text-sm text-faint">
                  {entry.text}
                  <span className="ml-2 text-xs">· {t('build.queued')}</span>
                </p>
              </div>
            ))}

            <div ref={bottom} />

            <Confirm
              open={forking !== null}
              title={t('build.fork')}
              body={t('build.forkBody')}
              confirmLabel={t('build.fork')}
              cancelLabel={t('common.cancel')}
              onCancel={() => setForking(null)}
              onConfirm={() => {
                const index = forking
                setForking(null)
                if (index !== null) fork(index)
              }}
            />
          </div>
        </div>

        <footer
          className="shrink-0 border-t border-line bg-surface px-5 py-3"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            void addImages(event.dataTransfer.files)
          }}
        >
          <div className="mx-auto max-w-3xl">
            {pending ? (
              <Interrupt
                message={pending.message}
                onAnswer={(text) => answer(text, pending.index)}
                onApprove={() => approvePlan(pending.index)}
                onDismiss={() => resolveAt(pending.index)}
              />
            ) : null}

            <div className="relative rounded-[var(--radius-panel)] border border-line bg-bg transition-colors focus-within:border-focus">
              <SlashMenu
                open={slashMatches.length + commandMatches.length > 0}
                skills={slashMatches}
                commands={commandMatches}
                onPick={(name) => setDraft(complete(draft, name))}
              />

              {images.length > 0 ? (
                <div className="flex flex-wrap gap-2 border-b border-line p-2">
                  {images.map((image, index) => (
                    <span key={index} className="relative">
                      <img src={image} alt="" className="size-12 rounded-[var(--radius-control)] object-cover" />
                      <button
                        type="button"
                        title={t('common.delete')}
                        onClick={() => setImages(images.filter((_, position) => position !== index))}
                        className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-line bg-surface text-dim transition-colors hover:text-danger"
                      >
                        <Icon name="close" className="size-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="relative">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 max-h-56 min-h-20 overflow-hidden whitespace-pre-wrap break-words px-3.5 py-3 text-sm text-transparent"
                >
                  {highlight(draft, settings.skills)}
                </div>

                <textarea
                value={draft}
                rows={3}
                placeholder={pending ? t('build.answerHint') : t('build.placeholder')}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  const files = [...event.clipboardData.files]
                  if (files.length > 0) {
                    event.preventDefault()
                    void addImages(files)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  const wants = settings.sendOnEnter ? !event.shiftKey : event.ctrlKey || event.metaKey
                  if (!wants) return

                  event.preventDefault()
                  const first = commandMatches[0]?.name ?? slashMatches[0]?.name
                  if (typing !== undefined && first) {
                    setDraft(complete(draft, first))
                    return
                  }
                  send()
                }}
                className="relative max-h-56 min-h-20 w-full resize-none bg-transparent px-3.5 py-3 text-sm outline-none placeholder:text-faint"
                />
              </div>

              <div className="flex items-center gap-1 border-t border-line px-2 py-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(event) => {
                    if (event.target.files) void addImages(event.target.files)
                    event.target.value = ''
                  }}
                />
                <IconButton icon="image" title={t('build.attach')} onClick={() => fileInput.current?.click()} />

                <ModelPicker open={modelOpen} onOpenChange={setModelOpen} />

                <Dropdown label={t('settings.mode')} value={t(modeLabels[settings.mode])}>
                  {(close) =>
                    (['manual', 'auto', 'plan'] as const).map((mode) => (
                      <MenuItem
                        key={mode}
                        active={settings.mode === mode}
                        onClick={() => {
                          void store.patchSettings({ mode })
                          close()
                        }}
                      >
                        {t(modeLabels[mode])}
                      </MenuItem>
                    ))
                  }
                </Dropdown>

                <Dropdown label={t('settings.effort')} value={t(effortLabels[settings.effort])}>
                  {(close) =>
                    (['low', 'medium', 'high'] as const).map((effort) => (
                      <MenuItem
                        key={effort}
                        active={settings.effort === effort}
                        onClick={() => {
                          void store.patchSettings({ effort })
                          close()
                        }}
                      >
                        {t(effortLabels[effort])}
                      </MenuItem>
                    ))
                  }
                </Dropdown>

                <span className="ml-auto flex items-center gap-1">
                  <UsagePill usage={usage} slices={slices} />
                  {busy ? (
                    <IconButton icon="stop" title={t('build.stop')} onClick={() => abort.current?.abort()} />
                  ) : null}
                  <button
                    type="button"
                    title={t('build.send')}
                    disabled={!draft.trim() && images.length === 0}
                    onClick={send}
                    className="flex size-8 items-center justify-center rounded-[var(--radius-control)] bg-accent text-white transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Icon name="chevron" className="size-4 -rotate-90" />
                  </button>
                </span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}

type Slice = { label: string; tokens: number; className: string }

const estimate = (text: string) => Math.ceil(text.length / 4)

function UsagePill({ usage, slices }: { usage: { input: number; output: number }; slices: Slice[] }) {
  const { settings, t } = useStore()
  const [open, setOpen] = useState(false)

  const limit = settings.contextLimit
  const used = Math.min(limit, slices.reduce((sum, slice) => sum + slice.tokens, 0))
  const share = Math.round((used / limit) * 100)

  const rows: Slice[] = [
    ...slices.filter((slice) => slice.tokens > 0),
    { label: t('build.free'), tokens: limit - used, className: 'bg-raised' },
  ]

  return (
    <div className="relative">
      <button
        type="button"
        title={`${t('build.context')} ${share}%`}
        onClick={() => setOpen(!open)}
        className="flex items-center rounded-[var(--radius-control)] px-1.5 py-1 transition-colors hover:bg-raised"
      >
        <Ring value={used} total={limit} label={compact(used)} />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} align="right">
        <div className="w-72 space-y-2 px-3 py-2.5">
          <p className="flex items-baseline justify-between gap-4">
            <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
              {t('build.context')}
            </span>
            <span className="font-mono text-xs text-dim">
              {compact(used)} / {compact(limit)} ({share}%)
            </span>
          </p>

          <div className="flex h-2 overflow-hidden rounded-full bg-raised">
            {rows.map((slice) => (
              <span
                key={slice.label}
                title={slice.label}
                className={slice.className}
                style={{ width: `${(slice.tokens / limit) * 100}%` }}
              />
            ))}
          </div>

          <ul className="space-y-1">
            {rows.map((slice) => (
              <li key={slice.label} className="flex items-center gap-2 text-xs">
                <span className={cx('size-2 shrink-0 rounded-sm', slice.className)} />
                <span className="min-w-0 flex-1 truncate text-dim">{slice.label}</span>
                <span className="shrink-0 font-mono text-faint">{compact(slice.tokens)}</span>
                <span className="w-9 shrink-0 text-right font-mono text-faint">
                  {Math.round((slice.tokens / limit) * 100)}%
                </span>
              </li>
            ))}
          </ul>

          <p className="flex justify-between gap-6 border-t border-line pt-2 text-xs">
            <span className="text-dim">{t('build.spent')}</span>
            <span className="font-mono text-faint">
              {compact(usage.input)} · {compact(usage.output)}
            </span>
          </p>

          {share >= 70 ? (
            <p className="text-xs text-warn">
              <span className="font-mono">/compress</span> · {t('build.compressHint')}
            </p>
          ) : null}
        </div>
      </Popover>
    </div>
  )
}

function ChatGroup({
  label,
  items,
  current,
  running,
  onOpen,
  onNew,
}: {
  label: string
  items: Conversation[]
  current: string
  running: string | null
  onOpen: (conversation: Conversation) => void
  onNew: () => void
}) {
  if (items.length === 0) return null

  return (
    <>
      {label ? (
        <p className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      ) : null}
      <ul className="space-y-0.5">
        {items.map((conversation) => (
          <ChatRow
            key={conversation.id}
            conversation={conversation}
            active={conversation.id === current}
            running={conversation.id === running}
            onOpen={() => onOpen(conversation)}
            onNew={onNew}
          />
        ))}
      </ul>
    </>
  )
}

function ChatRow({
  conversation,
  active,
  running,
  onOpen,
  onNew,
}: {
  conversation: Conversation
  active: boolean
  running: boolean
  onOpen: () => void
  onNew: () => void
}) {
  const store = useStore()
  const { t } = store
  const [at, setAt] = useState<Anchor | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [title, setTitle] = useState(conversation.title)

  const save = (patch: Partial<Conversation>) => void store.saveConversation({ ...conversation, ...patch })

  if (renaming) {
    return (
      <li>
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && title.trim()) {
              save({ title: title.trim() })
              setRenaming(false)
            }
            if (event.key === 'Escape') setRenaming(false)
          }}
          className="w-full rounded-[var(--radius-control)] border border-line bg-bg px-2 py-1.5 text-[13px] outline-none"
        />
      </li>
    )
  }

  return (
    <li
      className={cx(
        'group relative rounded-[var(--radius-control)] transition-colors',
        active ? 'bg-accent-soft' : 'hover:bg-raised'
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cx(
          'flex w-full items-center gap-1.5 truncate rounded-[var(--radius-control)] py-2 pl-2.5 pr-9 text-left text-[13px] transition-colors',
          active ? 'text-accent' : 'text-dim group-hover:text-text'
        )}
      >
        {running ? (
          <Spinner className="size-3 shrink-0" />
        ) : conversation.pinned ? (
          <Icon name="pin" className="size-3 shrink-0" />
        ) : null}
        <span className="truncate">{conversation.title}</span>
      </button>

      <span
        className={cx(
          'absolute right-1 top-1/2 -translate-y-1/2 transition-opacity',
          at ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <IconButton
          icon="menu"
          tone="plain"
          size="sm"
          title={t('build.rename')}
          onClick={(event) => setAt(at ? null : anchorFrom(event))}
        />
      </span>

      <Menu at={at} onClose={() => setAt(null)}>
        <MenuItem
          icon="edit"
          onClick={() => {
            setRenaming(true)
            setAt(null)
          }}
        >
          {t('build.rename')}
        </MenuItem>
        <MenuItem
          icon={conversation.pinned ? 'unpin' : 'pin'}
          onClick={() => {
            save({ pinned: !conversation.pinned })
            setAt(null)
          }}
        >
          {conversation.pinned ? t('chat.unpin') : t('chat.pin')}
        </MenuItem>
        <MenuItem
          icon="archive"
          onClick={() => {
            save({ archived: !conversation.archived })
            setAt(null)
          }}
        >
          {conversation.archived ? t('chat.unarchive') : t('chat.archive')}
        </MenuItem>
        <MenuItem
          icon="trash"
          tone="danger"
          onClick={() => {
            setAt(null)
            setConfirming(true)
          }}
        >
          {t('common.delete')}
        </MenuItem>
      </Menu>

      <Confirm
        open={confirming}
        title={`${t('common.delete')} · ${conversation.title}`}
        body={t('common.confirmDelete')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          void store.deleteConversation(conversation.id)
          if (active) onNew()
        }}
      />
    </li>
  )
}

function SlashMenu({
  open,
  skills,
  commands: list,
  onPick,
}: {
  open: boolean
  skills: Skill[]
  commands: { name: string; hint: MessageKey }[]
  onPick: (name: string) => void
}) {
  const { t } = useStore()
  if (!open) return null

  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-96 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface p-1.5">
      {list.map((entry) => (
        <MenuItem key={entry.name} icon="plan" onClick={() => onPick(entry.name)}>
          <span className="font-mono">/{entry.name}</span>
          <span className="ml-2 text-xs text-faint">{t(entry.hint)}</span>
        </MenuItem>
      ))}

      {skills.slice(0, 6).map((entry) => (
        <MenuItem key={entry.id} icon="spark" onClick={() => onPick(entry.name)}>
          <span className="font-mono">/{entry.name}</span>
          <span className="ml-2 truncate text-xs text-faint">{entry.description}</span>
        </MenuItem>
      ))}

      {skills.length + list.length === 0 ? (
        <p className="px-2.5 py-2 text-[13px] text-faint">{t('build.slashEmpty')}</p>
      ) : null}
    </div>
  )
}

function ModelPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const store = useStore()
  const { settings, models, t } = store
  const [loading, setLoading] = useState(false)

  const list = models[settings.providerId] ?? []

  const toggle = () => {
    const next = !open
    onOpenChange(next)
    if (!next || list.length > 0) return

    setLoading(true)
    void store.loadModels().finally(() => setLoading(false))
  }

  return (
    <div className="relative">
      <button
        type="button"
        title="Ctrl+M"
        onClick={toggle}
        className="flex max-w-44 items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 font-mono text-xs text-dim transition-colors hover:bg-raised hover:text-text"
      >
        <span className="truncate">{settings.model || t('build.model')}</span>
        <Icon name="chevron" className="size-3 rotate-90" />
      </button>

      <Popover open={open} onClose={() => onOpenChange(false)}>
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="space-y-1.5 p-1.5">
              <Skeleton className="h-7" />
              <Skeleton className="h-7" />
              <Skeleton className="h-7" />
            </div>
          ) : list.length === 0 ? (
            <MenuItem active onClick={() => onOpenChange(false)}>
              <span className="font-mono text-xs">{settings.model}</span>
            </MenuItem>
          ) : (
            groupModels(list).map((group) => (
              <div key={group.label}>
                <p className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-faint">
                  {group.label}
                </p>
                {group.models.map((model) => (
                  <MenuItem
                    key={model}
                    active={model === settings.model}
                    onClick={() => {
                      void store.patchSettings({ model })
                      onOpenChange(false)
                    }}
                  >
                    <span className="font-mono text-xs">{model}</span>
                    {isFreeModel(model) ? <span className="ml-1 text-ok">· {t('settings.free')}</span> : null}
                  </MenuItem>
                ))}
              </div>
            ))
          )}
        </div>
      </Popover>
    </div>
  )
}

const markdownClass =
  'max-w-none text-sm leading-relaxed [&_a]:text-accent [&_code]:rounded [&_code]:bg-raised [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-[var(--radius-control)] [&_pre]:bg-raised [&_pre]:p-3 [&_pre_code]:bg-transparent [&_strong]:font-semibold [&_table]:my-2 [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5'

type Block =
  | { kind: 'activity'; steps: AgentStep[] }
  | { kind: 'text'; text: string }
  | { kind: 'artifact'; step: AgentStep }
  | { kind: 'memory'; facts: string[] }

function Live() {
  const { t } = useStore()

  return (
    <div className="flex items-center gap-2 text-[13px]">
      <Spinner className="size-3.5" />
      <span className="liveText">{t('build.working')}</span>
    </div>
  )
}

function Timeline({ message, allowed }: { message: Bubble; allowed: boolean }) {
  const steps = allowed ? message.steps : message.steps.filter((step) => step.kind !== 'thought')
  const legacy = allowed ? message.reasoning : ''

  const blocks: Block[] = []
  for (const step of steps) {
    const last = blocks[blocks.length - 1]
    if (step.kind === 'artifact') {
      blocks.push({ kind: 'artifact', step })
    } else if (step.kind === 'memory') {
      if (last?.kind === 'memory') last.facts.push(step.text)
      else blocks.push({ kind: 'memory', facts: [step.text] })
    } else if (step.kind === 'text') {
      if (last?.kind === 'text') last.text += step.text
      else blocks.push({ kind: 'text', text: step.text })
    } else if (last?.kind === 'activity') {
      last.steps.push(step)
    } else {
      blocks.push({ kind: 'activity', steps: [step] })
    }
  }

  const wrote = blocks.some((block) => block.kind === 'text')

  if (blocks.length === 0 && !legacy && !message.content) return message.streaming ? <Live /> : null

  return (
    <>
      {legacy ? <ActivityBlock steps={[]} legacy={legacy} live={false} /> : null}

      {blocks.map((block, index) => {
        const live = !!message.streaming && index === blocks.length - 1

        if (block.kind === 'text') {
          return (
            <div key={index} data-selectable className={markdownClass}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
            </div>
          )
        }

        if (block.kind === 'memory') return <Saved key={index} facts={block.facts} />
        if (block.kind === 'artifact') return <Artifact key={index} step={block.step} live={live} />
        return <ActivityBlock key={index} steps={block.steps} legacy="" live={live} />
      })}

      {!wrote && message.content ? (
        <div data-selectable className={markdownClass}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      ) : null}
    </>
  )
}

function ActivityBlock({ steps, legacy, live }: { steps: AgentStep[]; legacy: string; live: boolean }) {
  const { t } = useStore()
  const [open, setOpen] = useState<boolean | null>(null)

  const tools = steps.filter((step) => step.kind === 'tool').length
  const running = steps.some((step) => step.status === 'running')
  const busy = live || running
  const expanded = open ?? busy

  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-faint transition-colors hover:bg-raised hover:text-dim"
      >
        {busy ? <Spinner className="size-3.5" /> : <Icon name="spark" className="size-3.5" />}
        <span className={cx(busy && 'liveText')}>
          {running ? t('build.running') : busy ? t('build.thinking') : t('build.reasoning')}
        </span>
        {tools > 0 ? (
          <span className="text-xs">
            · {tools} {tools === 1 ? t('build.step') : t('build.steps')}
          </span>
        ) : null}
        <Icon name="chevron" className={cx('ml-auto size-3.5 transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded ? (
        <div className="space-y-2.5 border-t border-line px-3 py-3">
          {legacy ? (
            <div data-selectable className={cx(markdownClass, 'text-[13px] text-dim')}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{legacy}</ReactMarkdown>
            </div>
          ) : null}

          {steps.map((step, index) =>
            step.kind === 'thought' ? (
              <div key={index} data-selectable className={cx(markdownClass, 'text-[13px] text-dim')}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.text}</ReactMarkdown>
              </div>
            ) : (
              <div
                key={index}
                className="flex items-center gap-2 rounded-[var(--radius-control)] bg-raised px-2.5 py-1.5 text-xs"
              >
                {step.status === 'running' ? (
                  <Spinner className="size-3" />
                ) : (
                  <Icon
                    name={step.status === 'failed' ? 'close' : 'check'}
                    className={cx('size-3', step.status === 'failed' ? 'text-danger' : 'text-ok')}
                  />
                )}
                <span className="font-mono text-dim">{step.name}</span>
                {step.target ? <span className="truncate text-faint">{step.target}</span> : null}
                {step.source ? <span className="ml-auto shrink-0 text-faint">{step.source}</span> : null}
              </div>
            )
          )}
        </div>
      ) : null}
    </div>
  )
}

function Message({
  message,
  index,
  last,
  states,
  canApply,
  showReasoning,
  onApply,
  onEdit,
  onRegenerate,
  onFork,
}: {
  message: Bubble
  index: number
  last: boolean
  states: Record<string, ActionState>
  canApply: boolean
  showReasoning: boolean
  onApply: (action: Action, position: number) => void
  onEdit: (text: string) => void
  onRegenerate: () => void
  onFork: () => void
}) {
  const { t } = useStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end gap-2">
        {message.images.length > 0 ? (
          <div className="flex gap-2">
            {message.images.map((image, position) => (
              <img key={position} src={image} alt="" className="size-20 rounded-[var(--radius-control)] object-cover" />
            ))}
          </div>
        ) : null}

        {editing ? (
          <div className="w-full space-y-2">
            <textarea
              autoFocus
              value={draft}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              className="w-full resize-none rounded-[var(--radius-panel)] border border-line bg-bg px-4 py-2.5 text-sm outline-none focus:border-focus"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" tone="ghost" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                tone="primary"
                onClick={() => {
                  setEditing(false)
                  onEdit(draft.trim())
                }}
              >
                {t('build.send')}
              </Button>
            </div>
          </div>
        ) : message.content ? (
          <p
            data-selectable
            className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-panel)] bg-accent px-4 py-2.5 text-sm text-white"
          >
            {message.content}
          </p>
        ) : null}

        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton size="sm" icon="edit" title={t('build.edit')} onClick={() => setEditing(true)} />
          <IconButton
            size="sm"
            icon="copy"
            title={copied ? t('build.copied') : t('build.copy')}
            onClick={() => void copy()}
          />
          <IconButton size="sm" icon="fork" title={t('build.fork')} onClick={onFork} />
          <Stamp at={message.at} />
        </div>
      </div>
    )
  }

  return (
    <div className="group space-y-3">
      <Timeline message={message} allowed={showReasoning} />

      {message.actions.map((action, position) => (
        <ProposalCard
          key={`${action.path}:${position}`}
          action={action}
          state={states[`${index}:${position}`] ?? 'pending'}
          onApply={() => onApply(action, position)}
          canApply={canApply}
        />
      ))}



      {message.streaming ? null : (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton
            size="sm"
            icon="copy"
            title={copied ? t('build.copied') : t('build.copy')}
            onClick={() => void copy()}
          />
          {last ? (
            <IconButton size="sm" icon="refresh" title={t('build.regenerate')} onClick={onRegenerate} />
          ) : null}
          <IconButton size="sm" icon="fork" title={t('build.fork')} onClick={onFork} />
          <Stamp at={message.at} />
        </div>
      )}
    </div>
  )
}

function ProposalCard({
  action,
  state,
  onApply,
  canApply,
}: {
  action: Action
  state: ActionState
  onApply: () => void
  canApply: boolean
}) {
  const { t } = useStore()
  const [open, setOpen] = useState(false)
  const isScript = action.kind === 'script'

  return (
    <article className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface transition-colors hover:border-focus">
      <header className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-raised text-accent">
          <Icon name={action.kind === 'delete' ? 'trash' : isScript ? 'build' : 'spark'} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[13px]">{action.path}</p>
          <p className="truncate text-xs text-dim">{action.summary}</p>
        </div>

        {state === 'applied' ? (
          <Badge tone="ok">{t('build.applied')}</Badge>
        ) : state === 'failed' ? (
          <Badge tone="danger">{t('build.failed')}</Badge>
        ) : (
          <div className="flex items-center gap-1">
            {isScript ? (
              <IconButton
                icon="chevron"
                title={open ? t('build.hideCode') : t('build.viewCode')}
                onClick={() => setOpen(!open)}
              />
            ) : null}
            <Button
              size="sm"
              tone={action.kind === 'delete' ? 'danger' : 'primary'}
              disabled={!canApply || state === 'applying'}
              onClick={onApply}
            >
              {state === 'applying' ? <Spinner /> : t('build.apply')}
            </Button>
          </div>
        )}
      </header>

      {isScript && open ? (
        <pre
          data-selectable
          className="max-h-96 overflow-auto border-t border-line bg-bg p-4 font-mono text-[12.5px] leading-relaxed"
        >
          {action.source}
        </pre>
      ) : null}
    </article>
  )
}

function Stamp({ at }: { at: number }) {
  const language = useStore((state) => state.settings.language)
  if (!at) return null

  return (
    <span className="ml-1 text-[11px] text-faint" title={new Date(at).toLocaleString()}>
      {ago(at, language)}
    </span>
  )
}

function Interrupt({
  message,
  onAnswer,
  onApprove,
  onDismiss,
}: {
  message: Bubble
  onAnswer: (text: string) => void
  onApprove: () => void
  onDismiss: () => void
}) {
  const { t } = useStore()
  const [at, setAt] = useState(0)
  const [answers, setAnswers] = useState<string[]>(() => message.questions.map(() => ''))

  const questions = message.questions
  const question = questions[at]

  const pick = (option: string) => {
    const next = answers.map((entry, index) => (index === at ? option : entry))
    setAnswers(next)

    if (at < questions.length - 1) {
      setAt(at + 1)
      return
    }

    onAnswer(
      questions.map((entry, index) => `${entry.text}\n${next[index]?.trim() || '—'}`).join('\n\n')
    )
  }

  return (
    <div className="mb-2 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <header className="flex items-center gap-3 px-3.5 py-2.5">
        <p className="min-w-0 flex-1 text-[13px] font-medium">
          {message.plan ? message.plan.title : (question?.text ?? '')}
        </p>

        {questions.length > 1 ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint">
            <IconButton
              size="sm"
              tone="plain"
              icon="back"
              title={t('build.previous')}
              disabled={at === 0}
              onClick={() => setAt(at - 1)}
            />
            {at + 1}/{questions.length}
            <IconButton
              size="sm"
              tone="plain"
              icon="chevron"
              title={t('build.next')}
              disabled={at === questions.length - 1}
              onClick={() => setAt(at + 1)}
            />
          </span>
        ) : null}

        <IconButton size="sm" tone="plain" icon="close" title={t('build.skip')} onClick={onDismiss} />
      </header>

      {message.plan ? (
        <>
          <ol data-selectable className="divide-y divide-line border-t border-line">
            {message.plan.steps.map((step, index) => (
              <li key={index} className="flex items-start gap-3 px-3.5 py-2 text-[13px]">
                <span className="w-4 shrink-0 text-right text-[11px] text-faint">{index + 1}</span>
                <span className="min-w-0 flex-1 text-dim">{step}</span>
              </li>
            ))}
          </ol>

          <footer className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2">
            <span className="text-xs text-faint">{t('build.approveHint')}</span>
            <Button size="sm" tone="primary" onClick={onApprove}>
              {t('build.approvePlan')}
            </Button>
          </footer>
        </>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {(question?.options ?? []).map((option, index) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => pick(option)}
                className="group flex w-full items-center gap-3 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-raised"
              >
                <span className="w-4 shrink-0 text-right text-[11px] text-faint">{index + 1}</span>
                <span className="min-w-0 flex-1">{option}</span>
                <Icon
                  name="chevron"
                  className="size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
                />
              </button>
            </li>
          ))}

          <li className="flex items-center gap-3 px-3.5 py-2 text-[13px] text-faint">
            <Icon name="edit" className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{t('build.answerHint')}</span>
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-xs transition-colors hover:bg-raised hover:text-text"
            >
              {t('build.skip')}
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}

function Saved({ facts }: { facts: string[] }) {
  const { t } = useStore()

  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-xs">
      <Icon name="memory" className="mt-px size-3.5 shrink-0 text-accent" />
      <span className="shrink-0 text-dim">{t('build.saved')}</span>
      <span className="min-w-0 flex-1 text-faint">{facts.join(' · ')}</span>
    </div>
  )
}

function Artifact({ step, live }: { step: AgentStep; live: boolean }) {
  const { t } = useStore()
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? live

  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-faint transition-colors hover:bg-raised hover:text-dim"
      >
        {live ? <Spinner className="size-3.5" /> : <Icon name="agent" className="size-3.5 text-accent" />}
        <span className={cx('font-medium text-dim', live && 'liveText')}>{step.name}</span>
        <span className="truncate text-xs">{step.source}</span>
        <Icon name="chevron" className={cx('ml-auto size-3.5 transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded ? (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          {step.target ? <p className="text-xs text-faint">{step.target}</p> : null}
          {step.text ? (
            <div data-selectable className={cx(markdownClass, 'text-[13px] text-dim')}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.text}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-[13px] text-faint">{t('build.working')}</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
