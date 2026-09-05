import { net } from '@/app/lib/ipc'
import {
  capabilityOf,
  describeModel,
  readModel,
  supportsVision,
  usableForCode,
  type Capability,
  type ModelInfo,
} from './models.ts'
import { findProvider, type Provider, type ProviderId } from '@/app/lib/providers'

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> }
export type ToolCall = { id: string; name: string; args: string }

export type Effort = 'low' | 'medium' | 'high'

/** Low enough that Luau comes out deterministic, high enough to keep prose alive. */
export const TEMPERATURE = 0.2

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: string[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export type Delta =
  | { type: 'text'; text: string }
  | { type: 'truncated' }
  | { type: 'reasoning'; text: string }
  | { type: 'notice'; text: string }
  | { type: 'tool'; index: number; id?: string; name?: string; args?: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }

export type Endpoint = {
  provider: Provider
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  effort: Effort
  capability?: Capability
}

export function resolveEndpoint(input: {
  providerId: ProviderId
  customBaseUrl: string
  apiKey: string
  model: string
  effort?: Effort
  capability?: Capability
}): Endpoint {
  const provider = findProvider(input.providerId)
  const baseUrl = (provider.id === 'custom' ? input.customBaseUrl : provider.baseUrl).replace(/\/+$/, '')
  return {
    provider,
    baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    temperature: TEMPERATURE,
    effort: input.effort ?? 'medium',
    capability: input.capability,
  }
}

function splitDataUrl(value: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(value)
  return match?.[1] && match[2] ? { mediaType: match[1], data: match[2] } : null
}

function authHeaders(endpoint: Endpoint): Record<string, string> {
  if (endpoint.provider.dialect === 'anthropic') {
    return {
      'x-api-key': endpoint.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }
  return endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}
}

export function describeError(error: unknown, provider: Provider): string {
  const raw = error instanceof Error ? error.message : String(error)

  if (/401|invalid.?api.?key|unauthorized|authentication/i.test(raw)) {
    return `${provider.label} rejected the key. Check in Settings that you pasted it whole and that it is still active.`
  }
  if (/429|rate.?limit|quota/i.test(raw)) {
    return `You hit the rate limit on ${provider.label}. Wait a few seconds, switch model, or use another provider.`
  }
  if (/402|insufficient|billing|credit/i.test(raw)) {
    return `Your ${provider.label} account has no credit left for this call.`
  }
  if (/404|model_not_found|does not exist|decommissioned/i.test(raw)) {
    return 'That model is gone from this provider. Pick another one in Settings.'
  }
  if (/context|too.?large|413|maximum.*token/i.test(raw)) {
    return 'The synced place is bigger than this model can hold. Use a model with a larger context, or sync fewer services.'
  }
  if (/fetch|network|connect|ECONNREFUSED|dns/i.test(raw)) {
    return provider.id === 'ollama'
      ? 'Ollama is not answering. Open a terminal and run ollama serve.'
      : `Could not reach ${provider.label}. Check your connection.`
  }
  return `${provider.label} failed: ${raw}`
}

/** Reads the provider's own catalogue, with prices and context when it publishes them. */
export async function listCatalog(endpoint: Endpoint): Promise<ModelInfo[]> {
  const anthropic = endpoint.provider.dialect === 'anthropic'
  const url = anthropic ? `${endpoint.baseUrl}/models?limit=1000` : `${endpoint.baseUrl}/models`

  const response = await net(url, { headers: authHeaders(endpoint) }).catch(() => null)
  if (!response) throw new Error(`Could not reach ${endpoint.provider.label}.`)
  if (!response.ok) throw new Error(`HTTP ${response.status} while listing models.`)

  const body = (await response.json()) as { data?: unknown[] }
  const listed = (body.data ?? [])
    .map((entry) => readModel(entry as Parameters<typeof readModel>[0]))
    .filter((entry): entry is ModelInfo => entry !== null && usableForCode(entry.id))
    .sort((left, right) => left.id.localeCompare(right.id))

  return listed.length > 0 ? listed : endpoint.provider.fallbackModels.map(describeModel)
}

async function* frames(response: Response): AsyncGenerator<string> {
  const body = response.body
  if (!body) throw new Error('The response arrived with no body to read.')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')

        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) yield line.slice(5).trim()
        }
      }
    }
  } finally {
    // A cancelled request drops the underlying resource; releasing it then throws.
    try {
      reader.releaseLock()
    } catch {
      /* the stream is already gone */
    }
  }
}

async function ensureOk(response: Response, provider: Provider): Promise<void> {
  if (response.ok) return

  const detail = await response.text().catch(() => '')
  let message = detail.slice(0, 400)
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } | string }
    message = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? message)
  } catch {
    message = detail.slice(0, 400)
  }
  throw new Error(describeError(new Error(`${response.status} ${message}`), provider))
}

const IMAGE_DROPPED = '[image removed: this model does not read images]'

const rejectsImages = /image|vision|multi.?modal|content.*type|invalid.*content/i

const carriesImages = (messages: Message[]): boolean =>
  messages.some((message) => message.role === 'user' && !!message.images?.length)

function withoutImages(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role !== 'user' || !message.images?.length) return message
    const note = `${IMAGE_DROPPED.slice(0, -1)}, ${message.images.length} attached]`
    return { role: 'user', content: message.content ? `${message.content}\n\n${note}` : note }
  })
}

function dialectStream(
  endpoint: Endpoint,
  messages: Message[],
  tools: ToolDef[],
  signal: AbortSignal
): AsyncGenerator<Delta> {
  return endpoint.provider.dialect === 'anthropic'
    ? streamAnthropic(endpoint, messages, tools, signal)
    : streamOpenAi(endpoint, messages, tools, signal)
}

const RETRIES = 2

const retryable = /\b(429|500|502|503|504)\b|rate.?limit|overloaded|timeout|temporarily/i

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop)
      resolve()
    }, ms)
    const stop = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', stop, { once: true })
  })

/** Counts the prompt exactly where the provider offers it, and returns null where it does not. */
export async function countTokens(
  endpoint: Endpoint,
  messages: Message[],
  tools: ToolDef[]
): Promise<number | null> {
  if (endpoint.provider.dialect !== 'anthropic' || !endpoint.apiKey) return null

  try {
    const { system, converted } = toAnthropic(messages)
    const response = await net(`${endpoint.baseUrl}/messages/count_tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(endpoint) },
      body: JSON.stringify({
        model: endpoint.model,
        ...(system ? { system } : {}),
        messages: converted,
        ...(tools.length > 0 ? { tools: anthropicTools(tools) } : {}),
      }),
    })
    if (!response.ok) return null

    const body = (await response.json()) as { input_tokens?: number }
    return body.input_tokens ?? null
  } catch {
    return null
  }
}

export async function* streamChat(
  endpoint: Endpoint,
  messages: Message[],
  tools: ToolDef[],
  signal: AbortSignal
): AsyncGenerator<Delta> {
  const attached = carriesImages(messages)
  const blind = attached && !supportsVision(endpoint.model)
  let started = false

  if (blind) yield { type: 'notice', text: `${endpoint.model} does not read images. Sending the text alone.` }

  const payload = blind ? withoutImages(messages) : messages

  for (let attempt = 0; ; attempt++) {
    try {
      for await (const delta of dialectStream(endpoint, payload, tools, signal)) {
        started = true
        yield delta
      }
      return
    } catch (error) {
      if (signal.aborted) throw error
      const raw = error instanceof Error ? error.message : String(error)

      if (!started && attempt < RETRIES && retryable.test(raw)) {
        const pause = 1200 * 2 ** attempt
        yield { type: 'notice', text: `${endpoint.provider.label} is busy. Trying again in ${Math.round(pause / 1000)}s.` }
        await wait(pause, signal)
        continue
      }
      if (started || blind || !attached || !rejectsImages.test(raw)) throw error
      break
    }
  }

  yield { type: 'notice', text: `${endpoint.model} does not read images. Sent the text alone.` }
  yield* dialectStream(endpoint, withoutImages(messages), tools, signal)
}

async function* streamOpenAi(
  endpoint: Endpoint,
  messages: Message[],
  tools: ToolDef[],
  signal: AbortSignal
): AsyncGenerator<Delta> {
  const capability = endpoint.capability ?? capabilityOf(endpoint.model)
  const body = {
    model: endpoint.model,
    temperature: endpoint.temperature,
    stream: true,
    stream_options: { include_usage: true },
    messages: messages.map((message) => {
      if (message.role === 'tool') {
        return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.args },
          })),
        }
      }
      if (message.role === 'user' && message.images?.length) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: message.content },
            ...message.images.map((image) => ({ type: 'image_url', image_url: { url: image } })),
          ],
        }
      }
      return { role: message.role, content: message.content }
    }),
    ...(capability.reasoning === 'effort'
      ? { reasoning_effort: endpoint.effort, max_completion_tokens: capability.maxOutput }
      : { max_tokens: capability.maxOutput }),
    ...(tools.length > 0
      ? {
          tools: tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
          tool_choice: 'auto',
        }
      : {}),
  }

  const response = await net(`${endpoint.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...authHeaders(endpoint) },
    body: JSON.stringify(body),
  })
  await ensureOk(response, endpoint.provider)

  let counted: { inputTokens: number; outputTokens: number } | null = null
  let cut = false

  for await (const data of frames(response)) {
    if (data === '[DONE]') break

    let chunk: {
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        input_tokens?: number
        output_tokens?: number
      }
      choices?: {
        finish_reason?: string | null
        delta?: {
          content?: string
          reasoning?: string
          reasoning_content?: string
          thinking?: string
          reasoning_details?: { text?: string; summary?: string }[]
          tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
        }
      }[]
    }
    try {
      chunk = JSON.parse(data)
    } catch {
      continue
    }

    if (chunk.usage) {
      const input = chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? 0
      const output = chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? 0
      if (input > 0 || output > 0) counted = { inputTokens: input, outputTokens: output }
    }

    const choice = chunk.choices?.[0]
    if (choice?.finish_reason === 'length') cut = true

    const delta = choice?.delta
    if (!delta) continue

    const reasoning =
      delta.reasoning ??
      delta.reasoning_content ??
      delta.thinking ??
      delta.reasoning_details?.map((entry) => entry.text ?? entry.summary ?? '').join('')

    if (reasoning) yield { type: 'reasoning', text: reasoning }
    if (delta.content) yield { type: 'text', text: delta.content }

    for (const call of delta.tool_calls ?? []) {
      yield {
        type: 'tool',
        index: call.index,
        id: call.id,
        name: call.function?.name,
        args: call.function?.arguments,
      }
    }
  }

  if (counted) yield { type: 'usage', ...counted }
  if (cut) yield { type: 'truncated' }
}

function anthropicTools(tools: ToolDef[]): unknown[] {
  return tools.map((tool, index) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
    ...(index === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
  }))
}

function toAnthropic(messages: Message[]): {
  system: { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }[] | null
  converted: { role: 'user' | 'assistant'; content: unknown }[]
} {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => (message as { content: string }).content)
    .join('\n\n')

  const converted: { role: 'user' | 'assistant'; content: unknown }[] = []

  for (const message of messages) {
    if (message.role === 'system') continue

    if (message.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }
      const last = converted[converted.length - 1]
      if (last?.role === 'user' && Array.isArray(last.content)) {
        ;(last.content as unknown[]).push(block)
      } else {
        converted.push({ role: 'user', content: [block] })
      }
      continue
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const blocks: unknown[] = []
      if (message.content) blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls) {
        let input: unknown = {}
        try {
          input = JSON.parse(call.args || '{}')
        } catch {
          input = {}
        }
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input })
      }
      converted.push({ role: 'assistant', content: blocks })
      continue
    }

    if (message.role === 'user' && message.images?.length) {
      const blocks: unknown[] = message.images.flatMap((image) => {
        const parsed = splitDataUrl(image)
        return parsed
          ? [{ type: 'image', source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data } }]
          : []
      })
      blocks.push({ type: 'text', text: message.content })
      converted.push({ role: 'user', content: blocks })
      continue
    }

    converted.push({ role: message.role, content: message.content })
  }

  return {
    system: system ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : null,
    converted,
  }
}

async function* streamAnthropic(
  endpoint: Endpoint,
  messages: Message[],
  tools: ToolDef[],
  signal: AbortSignal
): AsyncGenerator<Delta> {
  const { system, converted } = toAnthropic(messages)
  const capability = endpoint.capability ?? capabilityOf(endpoint.model)

  const budget = { low: 0, medium: 4_000, high: 12_000 }[endpoint.effort]
  const thinking = capability.reasoning === 'budget' && budget > 0
  const maxTokens = Math.max(capability.maxOutput, thinking ? budget + 4_000 : 0)

  const response = await net(`${endpoint.baseUrl}/messages`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...authHeaders(endpoint) },
    body: JSON.stringify({
      model: endpoint.model,
      max_tokens: maxTokens,
      temperature: thinking ? 1 : endpoint.temperature,
      stream: true,
      ...(thinking ? { thinking: { type: 'enabled', budget_tokens: budget } } : {}),
      ...(system ? { system } : {}),
      messages: converted,
      ...(tools.length > 0 ? { tools: anthropicTools(tools) } : {}),
    }),
  })
  await ensureOk(response, endpoint.provider)

  let inputTokens = 0
  let outputTokens = 0
  let cutShort = false

  for await (const data of frames(response)) {
    let event: {
      type?: string
      index?: number
      content_block?: { type?: string; id?: string; name?: string }
      delta?: {
        type?: string
        text?: string
        thinking?: string
        partial_json?: string
        stop_reason?: string
      }
      message?: {
        usage?: {
          input_tokens?: number
          output_tokens?: number
          cache_read_input_tokens?: number
          cache_creation_input_tokens?: number
        }
      }
      usage?: { output_tokens?: number; input_tokens?: number }
      error?: { message?: string }
    }
    try {
      event = JSON.parse(data)
    } catch {
      continue
    }

    if (event.type === 'error') {
      throw new Error(event.error?.message ?? 'Anthropic cut the stream short.')
    }
    if (event.type === 'message_start' && event.message?.usage) {
      const usage = event.message.usage
      inputTokens =
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0)
      outputTokens = usage.output_tokens ?? 0
    }
    if (event.type === 'message_delta' && event.delta?.stop_reason === 'max_tokens') cutShort = true
    if (event.type === 'message_delta' && event.usage) {
      if (event.usage.output_tokens !== undefined) outputTokens = event.usage.output_tokens
      if (event.usage.input_tokens !== undefined) inputTokens = Math.max(inputTokens, event.usage.input_tokens)
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      yield {
        type: 'tool',
        index: event.index ?? 0,
        id: event.content_block.id,
        name: event.content_block.name,
      }
      continue
    }
    if (event.type === 'content_block_delta') {
      const delta = event.delta
      if (delta?.type === 'text_delta' && delta.text) yield { type: 'text', text: delta.text }
      else if (delta?.type === 'thinking_delta' && delta.thinking)
        yield { type: 'reasoning', text: delta.thinking }
      else if (delta?.type === 'input_json_delta' && delta.partial_json)
        yield { type: 'tool', index: event.index ?? 0, args: delta.partial_json }
    }
  }

  if (inputTokens > 0 || outputTokens > 0) yield { type: 'usage', inputTokens, outputTokens }
  if (cutShort) yield { type: 'truncated' }
}
