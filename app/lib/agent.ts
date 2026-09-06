import { streamChat, type Endpoint, type Message, type ToolCall, type ToolDef } from '@/app/lib/llm'
import { callTool, isReadOnly, type McpConnection } from '@/app/lib/mcp'
import { readPages, searchWeb } from '@/app/lib/net'
import { buildSystemPrompt } from './prompt.ts'
import {
  action,
  uiAction,
  type Action,
  type ProjectNode,
  type Skill,
  type SpoofOptions,
} from '@/app/lib/schemas'
import { compileUi } from '@/app/lib/ui/compile'
import {
  cacheable,
  mutating,
  quiet,
  scriptClasses,
  slimDescription,
  slimSchema,
  studioTools,
  toolSize,
} from '@/app/lib/tools'

export type Approval = 'once' | 'always' | 'deny'

export type AgentEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string }
  | { type: 'toolStart'; id: string; name: string; target: string; source: string }
  | { type: 'toolEnd'; id: string; ok: boolean; output: string }
  | { type: 'action'; action: Action }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'notice'; text: string }
  | { type: 'question'; questions: { text: string; options: string[] }[] }
  | { type: 'remember'; facts: string[] }
  | { type: 'plan'; title: string; steps: string[] }
  | { type: 'done'; reason: 'finished' | 'waiting' | 'limit' }

export type AssetBridge = { respoof: (options: Partial<SpoofOptions>) => Promise<string> }
export type AgentRole = {
  name: string
  model: string
  instructions: string
  trigger: string
  effort: 'low' | 'medium' | 'high'
}
export type ToolNote = { name: string; target: string; source: string }

export type AgentInput = {
  endpoint: Endpoint
  history: { role: 'user' | 'assistant'; content: string; images?: string[] }[]
  nodes: ProjectNode[]
  truncated: boolean
  attached: string[]
  selection: string[]
  skills: Skill[]
  plan: boolean
  instructions: string
  person: string
  language: string
  memories: string[]
  references: string[]
  agents: AgentRole[]
  delegate: (agent: AgentRole, task: string) => Promise<string>
  mcp: McpConnection[]
  assets: AssetBridge
  canEditPlace: boolean
  signal: AbortSignal
  /** Asked before a tool that can change the live session runs. */
  approve?: (note: ToolNote) => Promise<Approval>
}

type Outcome = { output: string; event?: AgentEvent; ok?: boolean }

const CACHE_LIMIT = 8_000

/** Enough for a real change with every read it needs, short of a runaway loop. */
export const MAX_TURNS = 12

/** How many times a clipped answer may pick itself back up. */
const MAX_CONTINUES = 2

const noise = new Set(['summary', 'source', 'className', 'kind', 'assetKind'])
const preferred = ['path', 'urls', 'queries', 'query', 'url', 'name', 'prompt', 'instance', 'script']

/** A batch is labelled by its first item and how many more came with it. */
function label(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''

  const items = value.filter((entry): entry is string => typeof entry === 'string')
  if (items.length === 0) return ''
  return items.length === 1 ? (items[0] ?? '') : `${items[0]} +${items.length - 1}`
}

function firstString(args: Record<string, unknown>): string {
  for (const [key, value] of Object.entries(args)) {
    if (noise.has(key)) continue
    const found = label(value)
    if (found && found.length <= 160) return found
  }
  return ''
}

function describe(call: ToolCall, connections: McpConnection[]): ToolNote | null {
  if (quiet.has(call.name)) return null

  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(call.args || '{}') as Record<string, unknown>
  } catch {
    args = {}
  }

  const named = preferred.map((key) => label(args[key])).find(Boolean)
  const target = (named || firstString(args)).slice(0, 140)
  const remote = connections.flatMap((entry) => entry.tools).find((tool) => tool.name === call.name)

  if (!remote) return { name: call.name, target, source: 'jStudio' }

  const server = connections.find((entry) => entry.server.id === remote.serverId)
  return { name: remote.remoteName, target, source: server?.server.label ?? 'MCP' }
}

const DECLINED = 'The person declined that call. Do not try it again; ask them what to do instead.'

/** Reading is free. Anything that can touch the live session is asked about. */
function needsApproval(call: ToolCall, input: AgentInput): boolean {
  if (!input.approve) return false
  if (!input.mcp.some((entry) => entry.tools.some((tool) => tool.name === call.name))) return false
  return !reusable(call, input.mcp)
}

function reusable(call: ToolCall, connections: McpConnection[]): boolean {
  if (mutating.has(call.name)) return false
  if (cacheable.has(call.name)) return true

  const remote = connections.flatMap((entry) => entry.tools).find((tool) => tool.name === call.name)
  return remote ? isReadOnly(remote) : false
}

export async function* runAgent(input: AgentInput): AsyncGenerator<AgentEvent> {
  const mcpTools = input.mcp.flatMap((connection) => connection.tools)
  const tools: ToolDef[] = [
    ...studioTools.filter((tool) => tool.name !== 'delegate' || input.agents.length > 0),
    ...mcpTools.map((tool) => ({
      name: tool.name,
      description: slimDescription(tool.description),
      parameters: slimSchema(tool.inputSchema) as Record<string, unknown>,
    })),
  ]

  /**
   * What the tool catalogue costs on every request. It is the app's overhead,
   * not the person's turn, so it is taken off what the ledger is told.
   */
  const toolWeight = toolSize(tools)

  const conversation: Message[] = [
    {
      role: 'system',
      content: buildSystemPrompt({
        ...input,
        studioMcp: input.mcp.some((entry) => entry.server.id === 'robloxStudio' && !entry.error),
      }),
    },
    ...input.history.map((message) =>
      message.role === 'user'
        ? { role: 'user' as const, content: message.content, images: message.images }
        : { role: 'assistant' as const, content: message.content }
    ),
  ]

  const answered = new Map<string, string>()
  let continued = 0
  let wrote = false
  let waiting = false
  let closed = false
  let idle = 0

  for (let turn = 0; turn < MAX_TURNS && !waiting && !closed; turn++) {
    let text = ''
    const drafts = new Map<number, { id: string; name: string; args: string }>()
    let broke = false
    let clipped = false

    try {
      for await (const delta of streamChat(input.endpoint, conversation, tools, input.signal)) {
        if (delta.type === 'reasoning') yield { type: 'reasoning', text: delta.text }
        else if (delta.type === 'notice') yield { type: 'notice', text: delta.text }
        else if (delta.type === 'usage')
          yield {
            type: 'usage',
            inputTokens: Math.max(0, delta.inputTokens - toolWeight),
            outputTokens: delta.outputTokens,
          }
        else if (delta.type === 'truncated') clipped = true
        else if (delta.type === 'text') {
          text += delta.text
          wrote = true
          yield { type: 'text', text: delta.text }
        } else if (delta.type === 'tool') {
          const draft = drafts.get(delta.index) ?? { id: '', name: '', args: '' }
          if (delta.id) draft.id = delta.id
          if (delta.name) draft.name = delta.name
          if (delta.args) draft.args += delta.args
          drafts.set(delta.index, draft)
        }
      }
    } catch (error) {
      if (input.signal.aborted) throw error
      broke = true
      conversation.push({
        role: 'user',
        content: `The last call failed with: ${error instanceof Error ? error.message : String(error)}. Do not retry it.`,
      })
    }

    /** The model hit its output ceiling: carry on from where it stopped. */
    if (clipped && drafts.size === 0 && continued < MAX_CONTINUES) {
      continued += 1
      conversation.push({ role: 'assistant', content: text })
      conversation.push({
        role: 'user',
        content:
          'Your answer was cut off at the length limit. Continue from exactly where you stopped, in the same language, with no preamble and without repeating what you already wrote.',
      })
      continue
    }

    const calls: ToolCall[] = Array.from(drafts.values())
      .filter((draft) => draft.name.trim())
      .map((draft, index) => ({
        id: draft.id || `call_${turn}_${index}`,
        name: draft.name.trim(),
        args: draft.args,
      }))

    if (broke || calls.length === 0) {
      closed = true
      break
    }

    conversation.push({ role: 'assistant', content: text, toolCalls: calls })

    const parallel = new Map(
      calls
        .filter((call) => call.name === 'delegate')
        .slice(0, 3)
        .map((call) => [call.id, execute(call, input)] as const)
    )

    let worked = false

    for (const call of calls) {
      const note = describe(call, input.mcp)
      const key = `${call.name}:${call.args}`
      const cached = reusable(call, input.mcp) ? answered.get(key) : undefined

      if (cached !== undefined) {
        if (note) {
          yield { type: 'toolStart', id: call.id, ...note }
          yield { type: 'toolEnd', id: call.id, ok: true, output: cached.slice(0, 600) }
        }
        conversation.push({ role: 'tool', toolCallId: call.id, content: cached })
        continue
      }

      worked = true

      const decision = note && needsApproval(call, input) ? await input.approve?.(note) : undefined
      if (decision === 'deny') {
        if (note) {
          yield { type: 'toolStart', id: call.id, ...note }
          yield { type: 'toolEnd', id: call.id, ok: false, output: DECLINED }
        }
        conversation.push({ role: 'tool', toolCallId: call.id, content: DECLINED })
        continue
      }

      if (note) yield { type: 'toolStart', id: call.id, ...note }

      const outcome = await (parallel.get(call.id) ?? execute(call, input))
      const ok = outcome.ok !== false

      if (note) yield { type: 'toolEnd', id: call.id, ok, output: outcome.output.slice(0, 600) }
      if (ok && reusable(call, input.mcp)) answered.set(key, outcome.output.slice(0, CACHE_LIMIT))
      if (outcome.event) yield outcome.event
      if (outcome.event?.type === 'question' || outcome.event?.type === 'plan') waiting = true

      conversation.push({ role: 'tool', toolCallId: call.id, content: outcome.output })
    }

    idle = worked ? 0 : idle + 1
    if (idle === 1) {
      conversation.push({
        role: 'user',
        content:
          'That turn called nothing new; you already have those answers. Make the change now, in one turn with every call it needs, or write the reply.',
      })
    }
    if (idle >= 2) closed = true
  }

  if (waiting) {
    yield { type: 'done', reason: 'waiting' }
    return
  }

  const spent = !closed
  if (spent || !wrote) {
    conversation.push({
      role: 'user',
      content: wrote
        ? 'That is the end of the working turns. Close with a short report: what landed, what is left, what you would do next. No tools.'
        : 'Answer the request now in text. Say what you did, what you found and what happens next. No tools.',
    })

    for (let attempt = 0; attempt <= MAX_CONTINUES; attempt++) {
      let tail = ''
      let clipped = false

      for await (const delta of streamChat(input.endpoint, conversation, [], input.signal)) {
        if (delta.type === 'reasoning') yield { type: 'reasoning', text: delta.text }
        else if (delta.type === 'notice') yield { type: 'notice', text: delta.text }
        else if (delta.type === 'truncated') clipped = true
        else if (delta.type === 'usage')
          yield { type: 'usage', inputTokens: delta.inputTokens, outputTokens: delta.outputTokens }
        else if (delta.type === 'text') {
          tail += delta.text
          yield { type: 'text', text: delta.text }
        }
      }

      if (!clipped) break

      conversation.push({ role: 'assistant', content: tail })
      conversation.push({
        role: 'user',
        content: 'Continue from exactly where you stopped. No preamble, no repetition.',
      })
    }
  }

  yield { type: 'done', reason: spent ? 'limit' : 'finished' }
}

type ExecuteInput = Pick<
  AgentInput,
  'nodes' | 'mcp' | 'assets' | 'agents' | 'delegate' | 'canEditPlace' | 'language'
>

async function execute(call: ToolCall, input: ExecuteInput): Promise<Outcome> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(call.args || '{}') as Record<string, unknown>
  } catch {
    return { output: 'Those arguments were not valid JSON. Send the call again in the right shape.', ok: false }
  }

  const handler = handlers[call.name]
  if (handler) return handler(args, input)

  const remote = input.mcp.flatMap((entry) => entry.tools).find((tool) => tool.name === call.name)
  if (remote) {
    const connection = input.mcp.find((entry) => entry.server.id === remote.serverId)
    if (!connection) return { output: 'The MCP server behind that tool is no longer connected.', ok: false }

    const result = await callTool(connection, remote, args)
    return { output: result.text, ok: !result.failed }
  }

  return { output: `There is no tool called "${call.name}".`, ok: false }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => text(entry)).filter(Boolean) : []

const handlers: Record<string, (args: Record<string, unknown>, input: ExecuteInput) => Promise<Outcome>> = {
  readScript: async (args, input) => {
    const path = text(args.path)
    if (!path) return { output: 'readScript needs a path as text.', ok: false }

    const found = input.nodes.find((node) => node.path === path && node.source !== undefined)
    return {
      output: found?.source ?? `No synced script at "${path}". Check the place tree.`,
      ok: found !== undefined,
    }
  },

  askQuestion: async (args) => {
    const raw = Array.isArray(args.questions)
      ? args.questions
      : typeof args.question === 'string'
        ? [{ question: args.question, options: args.options }]
        : []

    const questions = raw
      .flatMap((entry) => {
        const item = entry as { question?: unknown; options?: unknown }
        const question = text(item.question)
        if (!question) return []
        return [
          {
            text: question,
            options: Array.isArray(item.options)
              ? item.options.filter((option): option is string => typeof option === 'string').slice(0, 4)
              : [],
          },
        ]
      })
      .slice(0, 3)

    if (questions.length === 0) return { output: 'askQuestion needs at least one question as text.', ok: false }

    return {
      output: 'The questions reached the person. Stop here and wait for their answers.',
      event: { type: 'question', questions },
    }
  },

  proposePlan: async (args) => {
    const title = text(args.title)
    const steps = Array.isArray(args.steps)
      ? args.steps.filter((entry): entry is string => typeof entry === 'string').slice(0, 8)
      : []

    if (!title || steps.length === 0) {
      return { output: 'proposePlan needs a title and at least one step.', ok: false }
    }

    return {
      output: 'The plan reached the person. Stop here and wait for them to approve it.',
      event: { type: 'plan', title, steps },
    }
  },

  remember: async (args) => {
    const raw = Array.isArray(args.facts) ? args.facts : typeof args.text === 'string' ? [args.text] : []
    const facts = raw
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 5)

    if (facts.length === 0) return { output: 'remember needs at least one fact as text.', ok: false }
    return { output: `Saved ${facts.length}.`, event: { type: 'remember', facts } }
  },

  delegate: async (args, input) => {
    const name = text(args.agent)
    const task = text(args.task)
    if (!name || !task) return { output: 'delegate needs an agent name and a task.', ok: false }

    const agent = input.agents.find((entry) => entry.name.toLowerCase() === name.toLowerCase())
    if (!agent) {
      const known = input.agents.map((entry) => entry.name).join(', ') || 'none'
      return { output: `No agent called "${name}" is on. Available: ${known}.`, ok: false }
    }

    const note = await input.delegate(agent, task)
    return { output: note || `${agent.name} came back empty. Carry on without them.` }
  },

  searchWeb: async (args, input) => {
    const queries = list(args.queries).length > 0 ? list(args.queries) : [text(args.query)].filter(Boolean)
    if (queries.length === 0) return { output: 'searchWeb needs at least one query.', ok: false }

    try {
      const hits = await searchWeb(queries, input.language)
      if (hits.length === 0) {
        return { output: `Nothing came back for ${queries.map((query) => `"${query}"`).join(', ')}.`, ok: false }
      }

      const found = [...new Set(hits.map((hit) => hit.source))].join(', ')
      const body = hits
        .map((hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`)
        .join('\n')

      return {
        output: `${hits.length} results from ${found} for ${queries.map((query) => `"${query}"`).join(', ')}:
${body}

Read the ones worth reading with readPages, in one call.`,
      }
    } catch (error) {
      return { output: error instanceof Error ? error.message : String(error), ok: false }
    }
  },

  readPages: async (args) => {
    const urls = list(args.urls).length > 0 ? list(args.urls) : [text(args.url)].filter(Boolean)
    if (urls.length === 0) return { output: 'readPages needs at least one address.', ok: false }

    const sources = await readPages(urls)
    const read = sources.filter((source) => source.ok)

    const index = sources
      .map((source) => `${source.ok ? '✓' : '✗'} ${source.url}${source.ok ? '' : ` — ${source.error}`}`)
      .join('\n')

    const body = read
      .map((source) => `
--- ${source.title || source.url}
${source.url}

${source.text}`)
      .join('\n')

    return {
      output: `Read ${read.length} of ${sources.length}:
${index}
${body}`,
      ok: read.length > 0,
    }
  },

  respoofAssets: async (args, input) => {
    const kind = args.assetKind
    const assetKind = kind === 'audio' || kind === 'image' || kind === 'mesh' ? kind : 'animation'

    return {
      output: await input.assets.respoof({
        assetKind,
        selectedOnly: args.selectedOnly === true,
        forceReupload: args.forceReupload === true,
        groupId: text(args.groupId),
      }),
    }
  },

  buildUi: async (args, input) => {
    if (!input.canEditPlace) return { output: OFFLINE, ok: false }

    const parsed = uiAction.safeParse({ ...args, kind: 'ui' })
    if (!parsed.success) {
      const problem = parsed.error.issues[0]
      return {
        output: `That tree was rejected: ${problem?.path.join('.') ?? 'field'} ${problem?.message ?? 'is invalid'}.`,
        ok: false,
      }
    }

    const built = compileUi(parsed.data)
    const note =
      built.skipped.length > 0
        ? ` Dropped what this tool does not write: ${built.skipped.slice(0, 8).join(', ')}.`
        : ''

    return {
      output: `Screen recorded, ${built.count} elements. The person reviews it and decides whether it lands.${note}`,
      event: { type: 'action', action: parsed.data },
    }
  },

  writeScript: (args, input) => propose('script', args, input),
  createInstance: (args, input) => propose('instance', args, input),
  deleteInstance: (args, input) => propose('delete', args, input),
}

const OFFLINE =
  "Roblox Studio's MCP server is not connected, so nothing can reach the place. Tell the person to open the place in Studio and let the jStudio plugin connect, then stop calling this tool."

async function propose(
  kind: 'script' | 'instance' | 'delete',
  args: Record<string, unknown>,
  input: ExecuteInput
): Promise<Outcome> {
  if (!input.canEditPlace) return { output: OFFLINE, ok: false }

  if (kind === 'instance' && scriptClasses.has(String(args.className))) {
    return {
      output: 'createInstance does not build scripts. Call writeScript with the complete Luau source instead.',
      ok: false,
    }
  }

  const parsed = action.safeParse({ ...args, kind })
  if (!parsed.success) {
    const problem = parsed.error.issues[0]
    return {
      output: `Proposal rejected: ${problem?.path.join('.') ?? 'field'} ${problem?.message ?? 'is invalid'}.`,
      ok: false,
    }
  }

  return {
    output: 'Proposal recorded. The person reviews it and decides whether it lands.',
    event: { type: 'action', action: parsed.data },
  }
}
