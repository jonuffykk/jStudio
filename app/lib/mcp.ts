import { mcpHost, net } from '@/app/lib/ipc'
import type { McpServer } from '@/app/lib/schemas'

const PROTOCOL_VERSION = '2025-06-18'
const VERSION = '1.0.6'
const TIMEOUT_MS = 30_000

export type McpTool = {
  name: string
  serverId: string
  remoteName: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpConnection = {
  server: McpServer
  tools: McpTool[]
  sessionId: string | null
  error: string | null
}

export const studioServer: McpServer = {
  id: 'robloxStudio',
  label: 'Roblox Studio',
  transport: 'stdio',
  command: 'studio',
  args: [],
  url: '',
  headers: {},
  enabled: true,
}

let requestId = 0

const toolName = (serverId: string, remoteName: string) =>
  `${serverId}_${remoteName}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)

type RemoteTool = { name: string; description?: string; inputSchema?: Record<string, unknown> }

const emptySchema = { type: 'object', properties: {} }

function describeTools(server: McpServer, tools: RemoteTool[]): McpTool[] {
  return tools.map((tool) => ({
    name: toolName(server.id, tool.name),
    serverId: server.id,
    remoteName: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? emptySchema,
  }))
}

async function httpRpc(
  server: McpServer,
  sessionId: string | null,
  method: string,
  params: Record<string, unknown>,
  notification = false
): Promise<{ result: Record<string, unknown>; sessionId: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await net(server.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': PROTOCOL_VERSION,
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        ...server.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        ...(notification ? {} : { id: ++requestId }),
      }),
    })

    if (!response.ok) throw new Error(`HTTP ${response.status} from ${server.label}`)

    const nextSession = response.headers.get('mcp-session-id') ?? sessionId
    if (notification) return { result: {}, sessionId: nextSession }

    const raw = await response.text()
    const payload = raw.includes('data:')
      ? (raw
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .at(-1) ?? '{}')
      : raw

    const message = JSON.parse(payload) as {
      error?: { message?: string }
      result?: Record<string, unknown>
    }
    if (message.error) throw new Error(message.error.message ?? 'The MCP server rejected the call.')
    return { result: message.result ?? {}, sessionId: nextSession }
  } finally {
    clearTimeout(timer)
  }
}

export async function connect(server: McpServer): Promise<McpConnection> {
  const base: McpConnection = { server, tools: [], sessionId: null, error: null }

  try {
    if (server.transport === 'stdio') {
      const { tools } = await mcpHost.connect(server.id, server.command, server.args)
      return { ...base, tools: describeTools(server, tools) }
    }

    const initialized = await httpRpc(server, null, 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'jStudio', version: VERSION },
    })
    await httpRpc(server, initialized.sessionId, 'notifications/initialized', {}, true)

    const listed = await httpRpc(server, initialized.sessionId, 'tools/list', {})
    const tools = Array.isArray(listed.result.tools) ? (listed.result.tools as RemoteTool[]) : []

    return { ...base, sessionId: initialized.sessionId, tools: describeTools(server, tools) }
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function disconnect(server: McpServer): Promise<void> {
  if (server.transport === 'stdio') await mcpHost.disconnect(server.id).catch(() => {})
}

export async function callTool(
  connection: McpConnection,
  tool: McpTool,
  args: Record<string, unknown>
): Promise<string> {
  try {
    if (connection.server.transport === 'stdio') {
      return await mcpHost.callTool(connection.server.id, tool.remoteName, args)
    }

    const { result } = await httpRpc(connection.server, connection.sessionId, 'tools/call', {
      name: tool.remoteName,
      arguments: args,
    })

    const content = Array.isArray(result.content) ? result.content : []
    const text = content
      .map((block) => {
        const entry = block as { type?: string; text?: string }
        return entry.type === 'text' ? (entry.text ?? '') : `[${entry.type ?? 'unknown'} content]`
      })
      .join('\n')
      .trim()

    return text || 'The tool returned nothing.'
  } catch (error) {
    return `The tool failed: ${error instanceof Error ? error.message : String(error)}`
  }
}
