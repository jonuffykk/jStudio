import type { Action, ChatUsage } from '@/app/lib/schemas'
import type { ApprovalRequest } from '@/app/views/chat/approval'
import { noSpend, type ActionState, type Bubble } from './types.ts'

/**
 * Everything one conversation owns while the app is open. Conversations run
 * side by side, so none of this can live in a single ref.
 */
export type Session = {
  id: string
  messages: Bubble[]
  usage: ChatUsage
  states: Record<string, ActionState>
  undo: Map<string, Action | null>
  approval: ApprovalRequest | null
  controller: AbortController | null
  model: string
  title: string
  savedAt: number
}

export function newSession(id: string, model = ''): Session {
  return {
    id,
    messages: [],
    usage: noSpend,
    states: {},
    undo: new Map(),
    approval: null,
    controller: null,
    model,
    title: '',
    savedAt: 0,
  }
}

export const isRunning = (session: Session | undefined) => !!session?.controller

let sequence = 0

export const newChatId = () => `chat${Date.now().toString(36)}${(sequence += 1).toString(36)}`
