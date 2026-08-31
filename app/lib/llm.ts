import { net } from '@/app/lib/ipc'
import { findProvider, usableForCode, type Provider, type ProviderId } from '@/app/lib/providers'

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> }
export type ToolCall = { id: string; name: string; args: string }

export type Effort = 'low' | 'medium' | 'high'

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: string[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export type Delta =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; index: number; id?: string; name?: string; args?: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }

export type Endpoint = {
  provider: Provider
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  effort: Effort
}

export function resolveEndpoint(input: {
  providerId: ProviderId
  customBaseUrl: string
  apiKey: string
  model: string
  temperature: number
  effort?: Effort
}): Endpoint {
  const provider = findProvider(input.providerId)
  const baseUrl = (provider.id === 'custom' ? input.customBaseUrl : provider.baseUrl).replace(/\/+$/, '')
  return {
    provider,
    baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    temperature: input.temperature,
    effort: input.effort ?? 'medium',
  }
}

function splitDataUrl(value: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(value)
  return match?.[1] && match[2] ? { mediaType: match[1], data: match[2] } : null
}

const reasoningModel = /gpt-5|^o[134]|reasoner|thinking/i

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

const freeModel = /:free|-free/i

export function isFreeModel(model: string): boolean {
  return freeModel.test(model)
}

export function groupModels(models: string[]): { label: string; models: string[] }[] {
  const groups = new Map<string, string[]>()

  for (const model of models) {
    const name = model.includes('/') ? (model.split('/')[0] ?? 'other') : model.split(/[-.]/)[0] ?? 'other'
    const label = name.charAt(0).toUpperCase() + name.slice(1)
    groups.set(label, [...(groups.get(label) ?? []), model])
  }

  return [...groups.entries()]
    .map(([label, entries]) => ({ label, models: entries.sort((a, b) => a.localeCompare(b)) }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export async function listModels(endpoint: Endpoint): Promise<string[]> {
  if (endpoint.provider.dialect === 'anthropic') {
    const response = await net(`${endpoint.baseUrl}/models?limit=100`, {
      headers: authHeaders(endpoint),
    }).catch(() => null)

    if (!response?.ok) return endpoint.provider.fallbackModels
    const body = (await response.json()) as { data?: { id: string }[] }
    const ids = (body.data ?? []).map((entry) => entry.id)
    return ids.length > 0 ? ids : endpoint.provider.fallbackModels
  }

  const response = await net(`${endpoint.baseUrl}/models`, { headers: authHeaders(endpoint) })
  if (!response.ok) throw new Error(`HTTP ${response.status} while listing models.`)

  const body = (await response.json()) as { data?: { id: string }[] }
  const ids = (body.data ?? [])
    .map((entry) => entry.id)
    .filter(usableForCode)
    .sort((left, right) => left.localeCompare(right))

  return ids.length > 0 ? ids : endpoint.provider.fallbackModels
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
    reader.releaseLock()
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

export async function* streamChat(
  endpoint: Endpoint,
  messages: Message[],
  tools: ToolDef[],
  signal: AbortSignal
): AsyncGenerator<Delta> {
  if (endpoint.provider.dialect === 'anthropic') {
    yield* streamAnthropic(endpoint, messages, tools, signal)
    return
  }
  yield* streamOpenAi(endpoint, messages, tools, signal)
}

async function* streamOpenAi(
  endpoint: Endpoint,
  messages: Message[],
  tools: ToolDef[],
  signal: AbortSignal
): AsyncGenerator<Delta> {
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
    ...(reasoningModel.test(endpoint.model) ? { reasoning_effort: endpoint.effort } : {}),
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

  for await (const data of frames(response)) {
    if (data === '[DONE]') return

    let chunk: {
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      choices?: {
        delta?: {
          content?: string
          reasoning?: string
          reasoning_content?: string
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
      yield {
        type: 'usage',
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
      }
    }

    const delta = chunk.choices?.[0]?.delta
    if (!delta) continue

    const reasoning = delta.reasoning ?? delta.reasoning_content
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
}

async function* streamAnthropic(
  endpoint: Endpoint,
  messages: Message[],
  tools: ToolDef[],
  signal: AbortSignal
): AsyncGenerator<Delta> {
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

  const thinking = endpoint.effort === 'high'

  const response = await net(`${endpoint.baseUrl}/messages`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...authHeaders(endpoint) },
    body: JSON.stringify({
      model: endpoint.model,
      max_tokens: 16000,
      temperature: thinking ? 1 : endpoint.temperature,
      stream: true,
      ...(thinking ? { thinking: { type: 'enabled', budget_tokens: 4000 } } : {}),
      ...(system
        ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] }
        : {}),
      messages: converted,
      ...(tools.length > 0
        ? {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
    }),
  })
  await ensureOk(response, endpoint.provider)

  for await (const data of frames(response)) {
    let event: {
      type?: string
      index?: number
      content_block?: { type?: string; id?: string; name?: string }
      delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
      message?: { usage?: { input_tokens?: number; output_tokens?: number } }
      usage?: { output_tokens?: number }
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
      yield {
        type: 'usage',
        inputTokens: event.message.usage.input_tokens ?? 0,
        outputTokens: event.message.usage.output_tokens ?? 0,
      }
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
}
