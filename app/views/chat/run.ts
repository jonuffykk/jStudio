'use client'

import { runAgent, type AgentEvent, type AgentRole } from '@/app/lib/agent'
import { spoof as spoofApi } from '@/app/lib/ipc'
import { streamChat, type Endpoint } from '@/app/lib/llm'
import { spoofOptions } from '@/app/lib/schemas'
import { useStore } from '@/app/lib/state'

export type Spend = (input: number, output: number) => void

/** Names the chat from its first message, in the language the person wrote it in. */
export async function generateTitle(endpoint: Endpoint, prompt: string, onSpend?: Spend): Promise<string> {
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

    for await (const delta of stream) {
      if (delta.type === 'usage') onSpend?.(delta.inputTokens, delta.outputTokens)
      else if (delta.type === 'text') text += delta.text
    }

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

export async function advise(
  endpoint: Endpoint,
  role: string,
  question: string,
  signal: AbortSignal,
  onDelta?: (text: string) => void,
  onSpend?: Spend
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
      if (delta.type === 'usage') onSpend?.(delta.inputTokens, delta.outputTokens)
      if (delta.type !== 'text') continue
      text += delta.text
      onDelta?.(delta.text)
    }
    return text.trim()
  } catch {
    return ''
  }
}

export async function summarise(
  endpoint: Endpoint,
  transcript: string,
  focus: string,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onSpend?: Spend
): Promise<void> {
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
    signal
  )

  for await (const delta of stream) {
    if (delta.type === 'usage') onSpend?.(delta.inputTokens, delta.outputTokens)
    else if (delta.type === 'text') onDelta(delta.text)
  }
}

export type AgentStream = AsyncGenerator<AgentEvent>

export function startAgent(input: Parameters<typeof runAgent>[0]): AgentStream {
  return runAgent(input) as AgentStream
}

export type { AgentEvent, AgentRole }

/** Re-uploads the assets of one kind and reports what changed, for the respoofAssets tool. */
export async function respoof(options: Parameters<typeof spoofOptions.parse>[0]): Promise<string> {
  const store = useStore.getState()
  const parsed = spoofOptions.parse({ ...store.settings.spoof, ...(options as object) })

  store.resetSpoof()
  useStore.setState({ spoofRunning: true, spoofPaused: false, spoofKind: parsed.assetKind })

  try {
    const result = await spoofApi.start(parsed)
    await store.refreshRuns()
    return `${result.done} replaced, ${result.failed} failed.`
  } finally {
    useStore.setState({ spoofRunning: false, spoofPaused: false, spoofStatus: '' })
  }
}
