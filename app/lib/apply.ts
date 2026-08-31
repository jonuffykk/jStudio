import { studio } from '@/app/lib/ipc'
import { luauFor } from '@/app/lib/luau'
import { callTool, type McpConnection, type McpTool } from '@/app/lib/mcp'
import type { Action } from '@/app/lib/schemas'

export type ApplyChannel = 'studioMcp' | 'plugin'
export type ApplyResult = { ok: boolean; message: string; channel: ApplyChannel | null }

const LUAU_TOOLS = ['execute_luau', 'run_code', 'run_luau', 'execute_code', 'runcode']
const SESSION_TOOLS = ['list_roblox_studios', 'list_studios']
const CODE_KEYS = ['command', 'code', 'script', 'source', 'luau']

const failed = /\berror\b|\bfailed\b|attempt to|stack traceback|is not a valid member/i

function findTool(connection: McpConnection, names: string[]): McpTool | undefined {
  return names
    .map((name) => connection.tools.find((tool) => tool.remoteName.toLowerCase() === name))
    .find(Boolean)
}

function properties(tool: McpTool): Record<string, unknown> {
  const schema = tool.inputSchema as { properties?: Record<string, unknown> }
  return schema.properties ?? {}
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

/** The MCP addresses a specific Studio window, so the id has to be discovered before the first call. */
async function sessionArgs(connection: McpConnection, tool: McpTool): Promise<Record<string, unknown>> {
  const keys = Object.keys(properties(tool))
  const key = keys.find((entry) => /^studio(_?id)?$/i.test(entry))
  if (!key) return {}

  const lister = findTool(connection, SESSION_TOOLS)
  if (!lister) return {}

  const listed = await callTool(connection, lister, {})
  const id = /\b\d{3,}\b/.exec(listed)?.[0]
  return id ? { [key]: id } : {}
}

async function applyThroughMcp(action: Action, connection: McpConnection): Promise<ApplyResult | null> {
  const tool = findTool(connection, LUAU_TOOLS)
  if (!tool) return null

  const args = { ...(await sessionArgs(connection, tool)), [codeKey(tool)]: luauFor(action) }
  const message = (await callTool(connection, tool, args)).trim()

  return failed.test(message)
    ? { ok: false, message, channel: 'studioMcp' }
    : { ok: true, message: message || `Applied ${action.path}.`, channel: 'studioMcp' }
}

async function applyThroughPlugin(action: Action): Promise<ApplyResult> {
  const id = await studio.enqueue(action)

  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 400))
    const result = await studio.result(id)
    if (result) return { ok: result.status === 'done', message: result.message, channel: 'plugin' }
  }
  return { ok: false, message: 'Studio never answered. Is the plugin still connected?', channel: 'plugin' }
}

/**
 * The MCP reaches the whole Instance API, the plugin bridge reaches only the properties it knows
 * about, so the MCP goes first and the plugin catches whatever it cannot serve. Both stay live.
 */
export async function applyAction(
  action: Action,
  connections: McpConnection[],
  pluginOnline: boolean
): Promise<ApplyResult> {
  const connection = studioMcp(connections)

  if (connection) {
    try {
      const result = await applyThroughMcp(action, connection)
      if (result?.ok || (result && !pluginOnline)) return result
    } catch {
      // Fall through to the plugin rather than losing the proposal.
    }
  }

  if (pluginOnline) return applyThroughPlugin(action)

  return {
    ok: false,
    message: connection
      ? 'Roblox Studio rejected the change and the plugin is not connected to retry it.'
      : "Connect Roblox Studio's MCP server, or the jStudio plugin, before applying changes.",
    channel: null,
  }
}
