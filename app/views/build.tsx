'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyAction, canApply as canApplyThrough } from '@/app/lib/apply'
import { storeImage } from '@/app/lib/blobs'
import { play } from '@/app/lib/host'
import { describeError, resolveEndpoint } from '@/app/lib/llm'
import { findProvider } from '@/app/lib/providers'
import { promptParts } from '@/app/lib/prompt'
import { useStore } from '@/app/lib/state'
import { subagents } from '@/app/lib/subagents'
import { studioTools } from '@/app/lib/tools'
import type { Action, Conversation } from '@/app/lib/schemas'
import type { MessageKey } from '@/app/lib/i18n'
import { Confirm, EmptyState, Icon, Skeleton } from '@/app/ui/primitives'
import { ApprovalCard, type ApprovalRequest } from '@/app/views/chat/approval'
import { Composer } from '@/app/views/chat/composer'
import { Interrupt } from '@/app/views/chat/interrupt'
import { Message } from '@/app/views/chat/message'
import { ChatSidebar } from '@/app/views/chat/sidebar'
import { UsagePill, type Slice } from '@/app/views/chat/usagePill'
import { advise, generateTitle, respoof, startAgent, summarise } from '@/app/views/chat/run'
import { isRunning, newChatId, newSession, type Session } from '@/app/views/chat/session'
import {
  appendSegment,
  attachmentsIn,
  bubble,
  noSpend,
  type ActionState,
  type Bubble,
} from '@/app/views/chat/types'

/**
 * A plan or a question lives in its own field, so the assistant turn that raised
 * it would reach the model empty. Give it words, and never send a blank turn.
 */
function asMessage(entry: Bubble): { role: 'user' | 'assistant'; content: string; images?: string[] } {
  if (entry.role === 'user') return { role: 'user', content: entry.content, images: entry.images }
  if (entry.content.trim()) return { role: 'assistant', content: entry.content }

  if (entry.plan) {
    const steps = entry.plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
    return { role: 'assistant', content: `Plan — ${entry.plan.title}\n${steps}` }
  }

  if (entry.questions.length > 0) {
    return {
      role: 'assistant',
      content: entry.questions.map((question) => `Question: ${question.text}`).join('\n'),
    }
  }

  return { role: 'assistant', content: '' }
}

/** A short line about who is on the other side, from the account and the profile. */
function describePerson(): string {
  const state = useStore.getState()
  const account = state.activeAccount()
  const { nickname, role } = state.settings.profile

  const name = nickname.trim() || account?.name || ''
  const trade = role === 'none' ? '' : state.t(`settings.role_${role}` as MessageKey)

  return [name ? `Call them ${name}.` : '', trade ? `They describe themselves as: ${trade}.` : '']
    .filter(Boolean)
    .join(' ')
}

const MAX_IMAGES = 4
const SAVE_EVERY = 1500

export function BuildView() {
  const store = useStore()
  const { settings, apiKey, nodes, truncated, mcp, conversations, t } = store

  const [conversationId, setConversationId] = useState(newChatId)
  const [messages, setMessages] = useState<Bubble[]>([])
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [usage, setUsage] = useState(noSpend)
  const [states, setStates] = useState<Record<string, ActionState>>({})
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<string[]>([])
  const [forking, setForking] = useState<number | null>(null)
  const [model, setModel] = useState('')
  const [atBottom, setAtBottom] = useState(true)

  const bottom = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const sessions = useRef(new Map<string, Session>())
  const current = useRef(conversationId)
  const runRef = useRef<((id: string, history: Bubble[], skillIds: string[]) => Promise<void>) | null>(null)

  /** The session of a chat, created on first sight. */
  const sessionOf = useCallback((id: string): Session => {
    const found = sessions.current.get(id)
    if (found) return found

    const fresh = newSession(id)
    sessions.current.set(id, fresh)
    return fresh
  }, [])

  const visible = useCallback((id: string) => id === current.current, [])

  const show = useCallback(
    (session: Session) => {
      if (!visible(session.id)) return
      setMessages(session.messages)
      setUsage(session.usage)
      setStates(session.states)
      setApproval(session.approval)
      setBusy(isRunning(session))
    },
    [visible]
  )

  const markLive = useCallback(() => {
    setLive([...sessions.current.values()].filter(isRunning).map((session) => session.id))
  }, [])

  const placeReady = canApplyThrough(mcp)
  const provider = findProvider(settings.providerId)
  const activeModel = model || settings.model
  const capability = store.modelInfo(activeModel)
  const sighted = capability.vision

  const endpoint = useMemo(
    () =>
      resolveEndpoint({
        providerId: settings.providerId,
        customBaseUrl: settings.customBaseUrl,
        apiKey,
        model: activeModel,
        effort: settings.effort,
        capability,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.providerId, settings.customBaseUrl, apiKey, activeModel, settings.effort]
  )

  const commit = useCallback(
    (id: string, next: Bubble[]) => {
      const session = sessionOf(id)
      session.messages = next
      if (visible(id)) setMessages(next)
    },
    [sessionOf, visible]
  )

  const persist = useCallback(
    (id: string, title?: string) => {
      const session = sessionOf(id)
      const saved = useStore.getState().conversations.find((entry) => entry.id === id)
      const first = session.messages.find((entry) => entry.role === 'user')?.content ?? 'Chat'
      if (title) session.title = title

      void useStore.getState().saveConversation({
        id,
        title: title ?? (session.title || saved?.title || first.slice(0, 40)),
        model: session.model,
        updatedAt: Date.now(),
        pinned: saved?.pinned ?? false,
        archived: saved?.archived ?? false,
        usage: session.usage,
        messages: session.messages.map(({ streaming: _streaming, ...rest }) => rest),
      })
    },
    [sessionOf]
  )

  const bank = useCallback(
    (
      id: string,
      model: string,
      input: number,
      output: number,
      source: 'chat' | 'title' | 'agent' | 'summary' = 'chat'
    ) => {
      if (input <= 0 && output <= 0) return

      const session = sessionOf(id)
      session.usage = {
        input: session.usage.input + input,
        output: session.usage.output + output,
        calls: session.usage.calls + (source === 'chat' ? 1 : 0),
        lastInput: source === 'chat' && input > 0 ? input : session.usage.lastInput,
      }

      if (visible(id)) setUsage(session.usage)
      useStore.getState().recordSpend(input, output, model, source)
    },
    [sessionOf, visible]
  )

  const setState = useCallback(
    (id: string, key: string, value: ActionState) => {
      const session = sessionOf(id)
      session.states = { ...session.states, [key]: value }
      if (visible(id)) setStates(session.states)
    },
    [sessionOf, visible]
  )

  const jump = useCallback((behavior: ScrollBehavior = 'smooth') => {
    stick.current = true
    setAtBottom(true)
    bottom.current?.scrollIntoView({ behavior })
  }, [])

  useEffect(() => {
    if (!stick.current) return
    bottom.current?.scrollIntoView({ behavior: busy ? 'auto' : 'smooth' })
  }, [messages, busy])

  /** A gesture upwards releases the auto follow at once, even mid stream. */
  useEffect(() => {
    const node = scroller.current
    if (!node) return

    const release = (event: WheelEvent) => {
      if (event.deltaY < 0 && stick.current) {
        stick.current = false
        setAtBottom(false)
      }
    }

    let start = 0
    const mark = (event: TouchEvent) => {
      start = event.touches[0]?.clientY ?? 0
    }
    const drag = (event: TouchEvent) => {
      if ((event.touches[0]?.clientY ?? 0) > start + 8 && stick.current) {
        stick.current = false
        setAtBottom(false)
      }
    }

    node.addEventListener('wheel', release, { passive: true })
    node.addEventListener('touchstart', mark, { passive: true })
    node.addEventListener('touchmove', drag, { passive: true })

    return () => {
      node.removeEventListener('wheel', release)
      node.removeEventListener('touchstart', mark)
      node.removeEventListener('touchmove', drag)
    }
  }, [])

  const openConversation = useCallback(
    (conversation: Conversation | null) => {
      const id = conversation?.id ?? newChatId()
      const known = sessions.current.get(id)

      const session =
        known ??
        Object.assign(newSession(id, conversation?.model ?? ''), {
          messages: conversation?.messages ?? [],
          usage: conversation?.usage ?? noSpend,
          title: conversation?.title ?? '',
        })

      sessions.current.set(id, session)
      current.current = id

      setConversationId(id)
      setModel(session.model)
      setImages([])
      show(session)
    },
    [show]
  )

  useEffect(() => {
    const onNew = () => openConversation(null)
    const onOpen = (event: Event) => openConversation((event as CustomEvent<Conversation>).detail)
    const onRenamed = (event: Event) => {
      const session = sessions.current.get((event as CustomEvent<string>).detail)
      if (session) session.title = ''
    }

    window.addEventListener('jstudio:newChat', onNew)
    window.addEventListener('jstudio:openChat', onOpen)
    window.addEventListener('jstudio:renamed', onRenamed)
    return () => {
      window.removeEventListener('jstudio:newChat', onNew)
      window.removeEventListener('jstudio:openChat', onOpen)
      window.removeEventListener('jstudio:renamed', onRenamed)
    }
  }, [openConversation])

  useEffect(() => {
    const known = new Set(conversations.map((entry) => entry.id))

    for (const [id, session] of sessions.current) {
      if (known.has(id) || id === current.current) continue
      session.controller?.abort()
      sessions.current.delete(id)
    }

    markLive()
  }, [conversations, markLive])

  const inverse = useCallback(
    (action: Action): Action | null => {
      if (action.kind === 'script') {
        const before = nodes.find((node) => node.path === action.path)
        return before?.source === undefined
          ? { kind: 'delete', path: action.path, summary: `Undo ${action.path}` }
          : { ...action, source: before.source, summary: `Restore ${action.path}` }
      }
      if (action.kind === 'instance') {
        const exists = nodes.some((node) => node.path === action.path)
        return exists ? null : { kind: 'delete', path: action.path, summary: `Undo ${action.path}` }
      }
      return null
    },
    [nodes]
  )

  const apply = useCallback(
    async (id: string, action: Action, key: string) => {
      setState(id, key, 'applying')
      sessionOf(id).undo.set(key, inverse(action))

      const state = useStore.getState()
      const result = await applyAction(action, state.mcp)

      setState(id, key, result.ok ? 'applied' : 'failed')
      play(result.ok ? 'done' : 'error', state.settings.sounds)

      if (!result.ok) state.toast(result.message, 'danger')
      else if (result.skipped.length > 0) state.toast(result.skipped.join('; '), 'info')

      await state.refreshTree()
    },
    [inverse, sessionOf, setState]
  )

  const applyAt = useCallback(
    (index: number, action: Action, position: number) =>
      void apply(current.current, action, `${index}:${position}`),
    [apply]
  )

  const forkAt = useCallback((index: number) => setForking(index), [])

  const regenerate = useCallback(() => {
    const id = current.current
    const list = sessionOf(id).messages
    if (list[list.length - 1]?.role === 'assistant') void runRef.current?.(id, list.slice(0, -1), [])
  }, [sessionOf])

  const editAt = useCallback(
    (index: number, text: string, images: string[]) => {
      const id = current.current
      const list = sessionOf(id).messages
      const target = list[index]
      if (!target) return

      const variants = [...(target.variants.length ? target.variants : [target.content]), text]
      void runRef.current?.(
        id,
        [
          ...list.slice(0, index),
          { ...target, content: text, images, at: Date.now(), variants, variant: variants.length - 1 },
        ],
        []
      )
    },
    [sessionOf]
  )

  const revertAt = useCallback(
    async (index: number, position: number) => {
      const id = current.current
      const key = `${index}:${position}`
      const back = sessionOf(id).undo.get(key)
      const state = useStore.getState()

      if (!back) {
        state.toast(state.t('build.nothingToRevert'))
        return
      }

      setState(id, key, 'applying')
      const result = await applyAction(back, state.mcp)

      setState(id, key, result.ok ? 'pending' : 'applied')
      if (!result.ok) state.toast(result.message, 'danger')
      else sessionOf(id).undo.delete(key)

      await state.refreshTree()
    },
    [sessionOf, setState]
  )

  const addImages = useCallback(
    async (files: FileList | File[]) => {
      if (!sighted) {
        store.toast(t('build.attachBlind', { model: activeModel }))
        return
      }

      const picked = [...files].filter((file) => file.type.startsWith('image/')).slice(0, MAX_IMAGES)
      const encoded = await Promise.all(
        picked.map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result))
              reader.onerror = () => reject(new Error('Could not read that image.'))
              reader.readAsDataURL(file)
            })
        )
      )

      setImages((entries) => [...entries, ...encoded].slice(0, MAX_IMAGES))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sighted, activeModel, t]
  )

  const run = useCallback(
    async (id: string, history: Bubble[], skillIds: string[]) => {
      const session = sessionOf(id)
      if (isRunning(session)) return

      const controller = new AbortController()
      session.controller = controller
      session.model = session.model || model
      markLive()

      const chatModel = session.model || settings.model
      const chatEndpoint = { ...endpoint, model: chatModel }

      commit(id, [...history, { ...bubble('assistant', ''), streaming: true }])
      if (visible(id)) setBusy(true)

      const startedAt = Date.now()
      let firstOutputAt = 0

      const update = (patch: (entry: Bubble) => Bubble) => {
        const list = session.messages
        const last = list[list.length - 1]
        if (!last) return
        commit(id, [...list.slice(0, -1), patch(last)])

        if (Date.now() - session.savedAt > SAVE_EVERY) {
          session.savedAt = Date.now()
          persist(id)
        }
      }

      const known = useStore.getState().conversations.some((entry) => entry.id === id)
      const opener = history.find((entry) => entry.role === 'user')?.content ?? ''

      /** The chat exists in the sidebar from the first turn; the name lands later. */
      if (!known && opener) {
        persist(id, t('build.newChat'))
        void generateTitle(chatEndpoint, opener, (input, output) =>
          bank(id, chatModel, input, output, 'title')
        ).then((title) => persist(id, title || t('build.newChat')))
      }

      try {
        const attached = history
          .filter((entry) => entry.role === 'user')
          .flatMap((entry) => attachmentsIn(entry.content))

        const stream = startAgent({
          endpoint: chatEndpoint,
          history: history.filter((entry) => !entry.folded).map(asMessage).filter((entry) => entry.content),
          nodes,
          truncated,
          attached,
          selection: useStore.getState().selection,
          skills: settings.skills.filter((entry) => skillIds.includes(entry.id)),
          plan: settings.mode === 'plan',
          instructions: settings.customInstructions,
          person: describePerson(),
          language: settings.language,
          memories: settings.memory.enabled ? settings.memory.items.map((entry) => entry.text) : [],
          references: settings.useChatHistory
            ? conversations
                .filter((entry) => entry.id !== id && entry.messages.length > 0)
                .slice(0, 8)
                .map((entry) => `${entry.title}: ${entry.messages[0]?.content.slice(0, 160) ?? ''}`)
            : [],
          agents: settings.subagents
            ? subagents.map((agent) => ({ ...agent, model: endpoint.model, effort: settings.effort }))
            : [],
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
              { ...chatEndpoint, model: agent.model, effort: agent.effort },
              agent.instructions,
              task,
              controller.signal,
              (delta) =>
                update((entry) => ({
                  ...entry,
                  steps: entry.steps.map((step, index) =>
                    index === at ? { ...step, text: step.text + delta } : step
                  ),
                })),
              (input, output) => bank(id, chatModel, input, output, 'agent')
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
          assets: { respoof },
          approve: async (note) => {
            const state = useStore.getState()
            if (state.settings.approval === 'auto' || state.settings.allowedTools.includes(note.name)) {
              return 'once'
            }

            return new Promise((resolve) => {
              const request = {
                ...note,
                resolve: (answer: 'once' | 'always' | 'deny') => {
                  session.approval = null
                  if (visible(id)) setApproval(null)
                  if (answer === 'always') {
                    void state.patchSettings({
                      allowedTools: [...new Set([...state.settings.allowedTools, note.name])],
                    })
                  }
                  resolve(answer)
                },
              }

              session.approval = request
              if (visible(id)) setApproval(request)
            })
          },
          canEditPlace: placeReady,
          signal: controller.signal,
        })

        for await (const event of stream) {
          if ((event.type === 'text' || event.type === 'toolStart') && !firstOutputAt) {
            firstOutputAt = Date.now()
          }

          if (event.type === 'text') {
            update((entry) => ({
              ...entry,
              content: entry.content + event.text,
              thinkMs: entry.thinkMs || firstOutputAt - startedAt,
              steps: appendSegment(entry.steps, 'text', event.text),
            }))
          } else if (event.type === 'reasoning') {
            update((entry) => ({ ...entry, steps: appendSegment(entry.steps, 'thought', event.text) }))
          } else if (event.type === 'toolStart') {
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
          } else if (event.type === 'toolEnd') {
            update((entry) => ({
              ...entry,
              steps: entry.steps.map((step) =>
                step.id === event.id
                  ? { ...step, status: event.ok ? 'done' : 'failed', text: event.output }
                  : step
              ),
            }))
          } else if (event.type === 'action') {
            update((entry) => ({ ...entry, actions: [...entry.actions, event.action] }))

            if (settings.mode === 'auto') {
              const index = session.messages.length - 1
              const position = (session.messages[index]?.actions.length ?? 1) - 1
              void apply(id, event.action, `${index}:${position}`)
            }
          } else if (event.type === 'notice') {
            store.toast(event.text)
          } else if (event.type === 'question') {
            update((entry) => ({ ...entry, questions: event.questions }))
          } else if (event.type === 'plan') {
            update((entry) => ({ ...entry, plan: { title: event.title, steps: event.steps } }))
          } else if (event.type === 'remember') {
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
          } else if (event.type === 'usage') {
            bank(id, chatModel, event.inputTokens, event.outputTokens)
          } else if (event.type === 'done' && event.reason === 'limit') {
            store.toast(t('build.turnsSpent'), 'info')
          }
        }

        play('done', settings.sounds)
        if (!document.hasFocus() || useStore.getState().view !== 'build' || !visible(id)) {
          store.notify(t('build.finished'))
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          update((entry) => ({ ...entry, content: entry.content || describeError(error, provider) }))
          play('error', settings.sounds)
        }
      } finally {
        update((entry) => ({
          ...entry,
          streaming: false,
          at: Date.now(),
          thinkMs: entry.thinkMs || (firstOutputAt ? firstOutputAt - startedAt : 0),
          replyMs: Date.now() - startedAt,
          steps: entry.steps.map((step) =>
            step.status === 'running' ? { ...step, status: 'failed' as const } : step
          ),
        }))

        session.controller = null
        session.approval = null
        markLive()

        if (visible(id)) {
          setBusy(false)
          setApproval(null)
        }
        persist(id)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint, model, nodes, truncated, settings, mcp, placeReady, provider, t, commit, persist, apply, bank]
  )

  useEffect(() => {
    runRef.current = run
  }, [run])

  const compress = useCallback(
    async (id: string, focus: string, label: string) => {
      const session = sessionOf(id)
      if (isRunning(session)) return

      const controller = new AbortController()
      session.controller = controller
      markLive()
      if (visible(id)) setBusy(true)

      const transcript = session.messages
        .map((entry) => `${entry.role === 'user' ? 'Person' : 'You'}: ${entry.content}`)
        .join('\n\n')
        .slice(-40_000)

      commit(id, [...session.messages, bubble('user', label), { ...bubble('assistant', ''), streaming: true }])

      const update = (patch: (entry: Bubble) => Bubble) => {
        const list = session.messages
        const last = list[list.length - 1]
        if (last) commit(id, [...list.slice(0, -1), patch(last)])
      }

      try {
        await summarise(
          endpoint,
          transcript,
          focus,
          controller.signal,
          (text) =>
            update((entry) => ({
              ...entry,
              content: entry.content + text,
              steps: appendSegment(entry.steps, 'text', text),
            })),
          (input, output) => bank(id, session.model || settings.model, input, output, 'summary')
        )

        const list = session.messages
        const summary = list[list.length - 1]
        const command = list[list.length - 2]

        if (summary && command) {
          commit(id, [
            ...list.slice(0, -2).map((entry) => ({ ...entry, folded: true })),
            command,
            { ...summary, streaming: false, at: Date.now() },
          ])
        }

        play('done', settings.sounds)
      } catch (error) {
        update((entry) => ({ ...entry, streaming: false, content: describeError(error, provider) }))
        play('error', settings.sounds)
      } finally {
        session.controller = null
        markLive()
        if (visible(id)) setBusy(false)
        persist(id)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint, commit, persist, provider, settings.sounds, settings.model, bank, sessionOf, visible]
  )

  /** /status and /tools answer from what the app already knows, with no model call. */
  const report = useCallback(
    (id: string, command: string): boolean => {
      const state = useStore.getState()
      const list = sessionOf(id).messages
      const usage = sessionOf(id).usage

      const modeLabel: MessageKey =
        settings.mode === 'auto'
          ? 'settings.modeAuto'
          : settings.mode === 'plan'
            ? 'settings.modePlan'
            : 'settings.modeManual'

      if (command === 'status') {
        const turns = list.filter((entry) => entry.role === 'user').length
        const tools = list.flatMap((entry) => entry.steps).filter((step) => step.kind === 'tool')
        const names = [...new Set(tools.map((step) => step.name))].slice(0, 8)

        const lines = [
          `**${t('build.statusTitle')}**`,
          '',
          `- ${t('settings.model')}: \`${activeModel}\``,
          `- ${t('settings.mode')}: ${t(modeLabel)}`,
          `- ${t('build.context')}: ${usage.lastInput.toLocaleString()} / ${settings.contextLimit.toLocaleString()}`,
          `- ${t('build.spentTotal')}: ${(usage.input + usage.output).toLocaleString()} · ${usage.calls} ${t('build.spentCalls')}`,
          `- ${t('build.steps')}: ${tools.length}${names.length > 0 ? ` (${names.join(', ')})` : ''}`,
          `- ${t('build.conversations')}: ${turns}`,
          '',
          `_${t('build.statusHint')}_`,
        ]

        commit(id, [...list, bubble('user', `/${command}`), bubble('assistant', lines.join('\n'))])
        persist(id)
        return true
      }

      if (command === 'tools') {
        const lines = [
          `**${t('settings.tools')}**`,
          '',
          ...studioTools.map((tool) => `- \`${tool.name}\` · jStudio`),
          ...state.mcp.flatMap((entry) => [
            '',
            `**${entry.server.label}**${entry.error ? ` — ${entry.error}` : ''}`,
            ...entry.tools.map((tool) => `- \`${tool.remoteName}\``),
          ]),
        ]

        commit(id, [...list, bubble('user', `/${command}`), bubble('assistant', lines.join('\n'))])
        persist(id)
        return true
      }

      return false
    },
    [activeModel, settings.mode, settings.contextLimit, commit, persist, sessionOf, t]
  )

  const send = useCallback(() => {
    const text = draft.trim()
    if (!text && images.length === 0) return

    const id = current.current
    const session = sessionOf(id)

    const compressing = /^\/compress\s*(.*)$/is.exec(text)
    if (compressing) {
      setDraft('')
      void compress(id, (compressing[1] ?? '').trim(), text)
      return
    }

    const local = /^\/(status|tools)\s*$/i.exec(text)?.[1]?.toLowerCase()
    if (local && report(id, local)) {
      setDraft('')
      return
    }

    const held = session.messages
    const open = held.length - 1
    const waiting = held[open]
    const base =
      waiting && !waiting.resolved && (waiting.plan || waiting.questions.length > 0)
        ? held.map((entry, index) => (index === open ? { ...entry, resolved: true } : entry))
        : held

    const mentioned = settings.skills.filter((entry) =>
      new RegExp(`(?:^|\\s)/${entry.name}\\b`, 'i').test(text)
    )

    const pending = [...images]
    setDraft('')
    setImages([])
    play('send', settings.sounds)
    jump('auto')

    void Promise.all(pending.map(storeImage)).then((stored) => {
      void run(id, [...base, bubble('user', text, stored)], mentioned.map((entry) => entry.id))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, images, run, compress, commit, report, jump, settings.skills, settings.sounds, t])

  const answer = (text: string, index?: number) => {
    const id = current.current
    const held = sessionOf(id).messages
    const base =
      index === undefined
        ? held
        : held.map((entry, position) => (position === index ? { ...entry, resolved: true } : entry))

    void run(id, [...base, bubble('user', text)], [])
  }

  const fork = (index: number) => {
    const slice = sessionOf(current.current).messages.slice(0, index + 1)
    const id = newChatId()
    const source = conversations.find((entry) => entry.id === conversationId)

    void store.saveConversation({
      id,
      title: t('build.forkOf', { title: source?.title ?? t('build.newChat') }).slice(0, 40),
      model,
      updatedAt: Date.now(),
      pinned: false,
      archived: false,
      usage: noSpend,
      messages: slice.map(({ streaming: _streaming, ...rest }) => rest),
    })

    const session = Object.assign(newSession(id, model), { messages: slice })
    sessions.current.set(id, session)
    current.current = id

    setConversationId(id)
    show(session)
    store.toast(t('build.forked'), 'ok')
  }

  const slices: Slice[] = useMemo(() => {
    const parts = promptParts({
      nodes,
      truncated,
      attached: messages.flatMap((entry) => (entry.role === 'user' ? attachmentsIn(entry.content) : [])),
      selection: store.selection,
      skills: [],
      studioMcp: placeReady,
      plan: settings.mode === 'plan',
      instructions: settings.customInstructions,
      person: describePerson(),
      memories: settings.memory.enabled ? settings.memory.items.map((entry) => entry.text) : [],
      references: [],
      agents: [],
    })

    const tone: Record<string, string> = {
      prompt: 'bg-accent/40',
      place: 'bg-accent',
      skills: 'bg-warn',
      memory: 'bg-danger/70',
    }

    const labels: Record<string, MessageKey> = {
      prompt: 'build.slicePrompt',
      place: 'build.slicePlace',
      skills: 'build.sliceSkills',
      memory: 'build.sliceMemory',
    }

    return [
      ...parts.map((part) => ({
        key: labels[part.key] ?? 'build.slicePrompt',
        chars: part.text.length,
        className: tone[part.key] ?? 'bg-accent',
      })),
      {
        key: 'build.sliceMessages' as MessageKey,
        chars: messages
          .filter((entry) => !entry.folded)
          .reduce((sum, entry) => sum + entry.content.length, 0),
        className: 'bg-accent/70',
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, truncated, messages, settings, placeReady])

  const last = messages[messages.length - 1]
  const pending =
    last && !last.streaming && !last.resolved && (last.plan || last.questions.length > 0)
      ? { message: last, index: messages.length - 1 }
      : null

  return (
    <div className="flex h-full">
      <ChatSidebar
        current={conversationId}
        running={live}
        ready={store.ready}
        onOpen={(conversation) => {
          openConversation(conversation)
          store.visitChat(conversation.id)
        }}
        onNew={() => openConversation(null)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line px-5">
          <h1 className="text-sm font-semibold">{t('nav.build')}</h1>
          <div className="flex items-center gap-3">
            {store.selection.length > 0 ? (
              <span className="text-[13px] text-faint">
                {t('build.selected', { count: store.selection.length })}
              </span>
            ) : null}
            <PlaceStatus ready={placeReady} />
          </div>
        </header>

        <div
          ref={scroller}
          onScroll={() => {
            const node = scroller.current
            if (!node) return

            const near = node.scrollHeight - node.scrollTop - node.clientHeight < 120
            stick.current = near
            if (near !== atBottom) setAtBottom(near)
          }}
          className="relative min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-7 px-6 py-8">
            {!store.ready ? (
              <Skeleton className="h-24" />
            ) : messages.length === 0 ? (
              <EmptyState icon="build" title={t('build.emptyTitle')} body={t('build.emptyBody')} />
            ) : (
              messages.map((message, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-7 [contain-intrinsic-size:auto_160px] [content-visibility:auto]"
                >
                  {message.folded && !messages[index + 1]?.folded ? (
                    <p className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-faint">
                      <span className="h-px flex-1 bg-line" />
                      {t('build.folded')}
                      <span className="h-px flex-1 bg-line" />
                    </p>
                  ) : null}

                  <Message
                    message={message}
                    index={index}
                    last={index === messages.length - 1}
                    states={states}
                    canApply={placeReady}
                    showReasoning={settings.showReasoning}
                    onApply={applyAt}
                    onRevert={revertAt}
                    onEdit={editAt}
                    onRegenerate={regenerate}
                    onFork={forkAt}
                  />
                </div>
              ))
            )}

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
          className="relative shrink-0 bg-bg px-5 pb-4 pt-2"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            void addImages(event.dataTransfer.files)
          }}
        >
          {!atBottom && messages.length > 0 ? (
            <button
              type="button"
              title={t('build.toBottom')}
              onClick={() => jump()}
              className="riseIn absolute -top-5 left-1/2 z-20 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-surface text-dim shadow-sm transition-colors hover:bg-raised hover:text-text"
            >
              <Icon name="chevron" className="size-4 rotate-90" />
            </button>
          ) : null}

          <div className="mx-auto max-w-3xl">
            {approval ? <ApprovalCard request={approval} /> : null}

            {pending ? (
              <Interrupt
                message={pending.message}
                onAnswer={(text) => answer(text, pending.index)}
                onApprove={() => {
                  if (settings.mode === 'plan') void store.patchSettings({ mode: 'manual' })
                  answer(t('build.planApproved'), pending.index)
                }}
                onDismiss={() => {
                  const id = current.current
                  commit(
                    id,
                    sessionOf(id).messages.map((entry, position) =>
                      position === pending.index ? { ...entry, resolved: true } : entry
                    )
                  )
                  persist(id)
                }}
              />
            ) : null}

            {pending || approval ? null : (
              <Composer
                draft={draft}
                images={images}
                busy={busy}
                answering={false}
                sighted={sighted}
                model={activeModel}
                usage={<UsagePill usage={usage} slices={slices} />}
                onDraft={setDraft}
                onDropImages={(files) => void addImages(files)}
                onRemoveImage={(index) => setImages(images.filter((_, position) => position !== index))}
                onSend={send}
                onStop={() => sessionOf(current.current).controller?.abort()}
                onModel={(picked) => {
                  setModel(picked)
                  sessionOf(current.current).model = picked
                  if (messages.length === 0) void store.patchSettings({ model: picked })
                }}
              />
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

function PlaceStatus({ ready }: { ready: boolean }) {
  const { plugin, t } = useStore()

  if (ready && plugin.installed && !plugin.outdated && plugin.paired) return null

  const message = !ready
    ? t('build.needsStudio')
    : !plugin.installed
      ? t('build.needsPlugin')
      : t('build.pluginStale')

  return (
    <span className="flex items-center gap-1.5 text-[13px] text-faint">
      <Icon name="plugin" className="size-3.5" />
      {message}
    </span>
  )
}
