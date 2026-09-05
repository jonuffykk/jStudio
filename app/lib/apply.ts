import { luauFor } from '@/app/lib/luau'
import { callTool, type McpConnection, type McpTool } from '@/app/lib/mcp'
import type { Action } from '@/app/lib/schemas'

export type ApplyResult = { ok: boolean; message: string; skipped: string[] }

const CODE_KEYS = ['command', 'code', 'script', 'source', 'luau']
const SESSION_KEY = /^studio(_?id)?$/i

const runsLuau = /luau|lua|code|script|eval|exec/i
const listsSessions = /list.*(studio|session)|studio.*list/i

const skippedNote = /\(skipped: ([^)]*)\)/

function properties(tool: McpTool): Record<string, unknown> {
  const schema = tool.inputSchema as { properties?: Record<string, unknown> }
  return schema.properties ?? {}
}

/** The Luau runner is the tool that takes a code-shaped argument, whatever it is called. */
function luauTool(connection: McpConnection): McpTool | undefined {
  return connection.tools.find((tool) => {
    const keys = Object.keys(properties(tool))
    return runsLuau.test(tool.remoteName) && CODE_KEYS.some((key) => keys.includes(key))
  })
}

function codeKey(tool: McpTool): string {
  const keys = Object.keys(properties(tool))
  return CODE_KEYS.find((key) => keys.includes(key)) ?? keys[0] ?? 'command'
}

export function studioMcp(connections: McpConnection[]): McpConnection | undefined {
  return connections.find(
    (entry) => entry.server.id === 'robloxStudio' && !entry.error && entry.tools.length > 0
  )
}

export function canApply(connections: McpConnection[]): boolean {
  const connection = studioMcp(connections)
  return !!connection && !!luauTool(connection)
}

let sessionCache: { serverId: string; key: string; value: string } | null = null

async function sessionArgs(connection: McpConnection, tool: McpTool): Promise<Record<string, unknown>> {
  const key = Object.keys(properties(tool)).find((entry) => SESSION_KEY.test(entry))
  if (!key) return {}

  if (sessionCache && sessionCache.serverId === connection.server.id && sessionCache.key === key) {
    return { [key]: sessionCache.value }
  }

  const lister = connection.tools.find((entry) => listsSessions.test(entry.remoteName))
  if (!lister) return {}

  const listed = await callTool(connection, lister, {})
  const id = /"?(?:studioId|id)"?\s*[:=]\s*"?(\d{3,})/i.exec(listed.text)?.[1] ?? /\b\d{4,}\b/.exec(listed.text)?.[0]
  if (!id) return {}

  sessionCache = { serverId: connection.server.id, key, value: id }
  return { [key]: id }
}

export function forgetStudioSession(): void {
  sessionCache = null
}

export async function applyAction(
  action: Action,
  connections: McpConnection[],
  select = false
): Promise<ApplyResult> {
  const connection = studioMcp(connections)
  if (!connection) {
    return { ok: false, message: "Roblox Studio's MCP server is not connected.", skipped: [] }
  }

  const tool = luauTool(connection)
  if (!tool) {
    return {
      ok: false,
      message: 'Roblox Studio is connected but exposes no tool that can run Luau.',
      skipped: [],
    }
  }

  const args = { ...(await sessionArgs(connection, tool)), [codeKey(tool)]: luauFor(action, select) }
  const result = await callTool(connection, tool, args)
  const message = result.text.trim()

  if (result.failed) {
    sessionCache = null
    return { ok: false, message, skipped: [] }
  }

  const skipped = (skippedNote.exec(message)?.[1] ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)

  return { ok: true, message: message || `Applied ${action.path}.`, skipped }
}
