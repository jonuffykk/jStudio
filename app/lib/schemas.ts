import { z } from 'zod'

export const instancePath = z
  .string()
  .min(1)
  .max(400)
  .regex(/^[A-Za-z_][\w ]*(\.[A-Za-z_][\w ]*)*$/, 'Path must look like Workspace.Arena.Platform')

const vector3 = z.tuple([z.number(), z.number(), z.number()])
const unitColor = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
const udim2 = z.tuple([z.number(), z.number(), z.number(), z.number()])

export const scriptAction = z.object({
  kind: z.literal('script'),
  path: instancePath,
  className: z.enum(['Script', 'LocalScript', 'ModuleScript']),
  source: z.string().min(1).max(200_000),
  summary: z.string().min(1).max(240),
})

export const instanceAction = z.object({
  kind: z.literal('instance'),
  path: instancePath,
  className: z.string().min(1).max(60).regex(/^[A-Za-z][A-Za-z0-9]*$/, 'Invalid class name'),
  summary: z.string().min(1).max(240),
  position: vector3.optional(),
  size: vector3.optional(),
  color: unitColor.optional(),
  anchored: z.boolean().optional(),
  material: z.string().max(40).optional(),
  transparency: z.number().min(0).max(1).optional(),
  text: z.string().max(500).optional(),
  uiSize: udim2.optional(),
  uiPosition: udim2.optional(),
})

export const deleteAction = z.object({
  kind: z.literal('delete'),
  path: instancePath,
  summary: z.string().min(1).max(240),
})

export const action = z.discriminatedUnion('kind', [scriptAction, instanceAction, deleteAction])
export type Action = z.infer<typeof action>

export const projectNode = z.object({
  path: z.string(),
  className: z.string(),
  source: z.string().optional(),
})
export type ProjectNode = z.infer<typeof projectNode>

export const account = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  avatarUrl: z.string().default(''),
  hasApiKey: z.boolean().default(false),
})
export type Account = z.infer<typeof account>

export const accountList = z.object({
  accounts: z.array(account).default([]),
  activeId: z.string().nullable().default(null),
})

export const bridgeStatus = z.object({
  online: z.boolean().default(false),
  port: z.number().default(0),
  placeId: z.string().nullable().default(null),
  placeName: z.string().nullable().default(null),
  pluginVersion: z.string().nullable().default(null),
  selectionCount: z.number().default(0),
  lastSeenAt: z.number().nullable().default(null),
  syncedAt: z.number().nullable().default(null),
  nodeCount: z.number().default(0),
  truncated: z.boolean().default(false),
})
export type BridgeStatus = z.infer<typeof bridgeStatus>

export const pluginStatus = z.object({
  installed: z.boolean().default(false),
  bundledVersion: z.string().default(''),
  runningVersion: z.string().nullable().default(null),
  outdated: z.boolean().default(false),
})
export type PluginStatus = z.infer<typeof pluginStatus>

export const mcpServer = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  transport: z.enum(['stdio', 'http']),
  command: z.string().max(400).default(''),
  args: z.array(z.string()).default([]),
  url: z.string().max(400).default(''),
  headers: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
})
export type McpServer = z.infer<typeof mcpServer>

export const catalogEntry = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  description: z.string().max(400).default(''),
  kind: z.enum(['skill', 'mcp']),
  instructions: z.string().max(20_000).default(''),
  transport: z.enum(['stdio', 'http']).default('http'),
  command: z.string().max(400).default(''),
  args: z.array(z.string()).default([]),
  url: z.string().max(400).default(''),
  homepage: z.string().max(400).default(''),
})
export type CatalogEntry = z.infer<typeof catalogEntry>

export const catalog = z.object({
  name: z.string().default('Library'),
  entries: z.array(catalogEntry).default([]),
})

export const skill = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  description: z.string().max(300).default(''),
  instructions: z.string().max(20_000),
  enabled: z.boolean().default(true),
  builtin: z.boolean().default(false),
})
export type Skill = z.infer<typeof skill>

export const spoofOptions = z.object({
  downloadOnly: z.boolean().default(false),
  downloadFolder: z.string().default(''),
  forceReupload: z.boolean().default(false),
  selectedOnly: z.boolean().default(false),
  autoName: z.boolean().default(true),
  groupId: z.string().default(''),
  overridePlaceId: z.string().default(''),
  maxPlaceIds: z.number().int().min(1).max(50).default(10),
  uploadRetries: z.number().int().min(1).max(10).default(2),
  downloadConcurrency: z.number().int().min(1).max(25).default(10),
  uploadConcurrency: z.number().int().min(1).max(25).default(10),
  only: z.array(z.string()).default([]),
})
export type SpoofOptions = z.infer<typeof spoofOptions>

export const memoryItem = z.object({
  id: z.string(),
  text: z.string().max(400),
  at: z.number().default(0),
})
export type MemoryItem = z.infer<typeof memoryItem>

export const memoryStore = z.object({
  enabled: z.boolean().default(true),
  items: z.array(memoryItem).default([]),
})

export const agentProfile = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  model: z.string().max(160).default(''),
  instructions: z.string().max(4000).default(''),
  enabled: z.boolean().default(false),
})
export type AgentProfile = z.infer<typeof agentProfile>

export const defaultAgents: AgentProfile[] = [
  {
    id: 'agent.reviewer',
    name: 'Reviewer',
    model: '',
    instructions:
      'You review a Roblox request before the main answer is written. Name what the answer is likely to get wrong, the edge cases in the game loop, and the parts of the request that are still ambiguous.',
    enabled: false,
  },
  {
    id: 'agent.security',
    name: 'Security',
    model: '',
    instructions:
      'You look at a Roblox request from the exploiter side. Point out remotes that trust the client, missing rate limits, ownership checks that are not there, and anything a client could send that the server would believe.',
    enabled: false,
  },
  {
    id: 'agent.performance',
    name: 'Performance',
    model: '',
    instructions:
      'You look at a Roblox request for cost. Point out per frame work that could be event driven, instances created in loops, unnecessary replication, and anything that will not hold at a hundred players.',
    enabled: false,
  },
  {
    id: 'agent.design',
    name: 'Game design',
    model: '',
    instructions:
      'You look at a Roblox request as a player. Say what would feel unclear, unfair or unrewarding, and name the one change that would make the feature more fun.',
    enabled: false,
  },
]

export const usageDay = z.object({
  day: z.string(),
  input: z.number().default(0),
  output: z.number().default(0),
  runs: z.number().default(0),
})
export type UsageDay = z.infer<typeof usageDay>

export const usagePulse = z.object({
  at: z.number(),
  input: z.number().default(0),
  output: z.number().default(0),
})
export type UsagePulse = z.infer<typeof usagePulse>

export const settings = z.object({
  language: z.enum(['en', 'pt', 'es']).default('en'),
  theme: z.enum(['dark', 'light', 'system']).default('light'),
  languagePicked: z.boolean().default(false),
  providerId: z
    .enum(['anthropic', 'openai', 'bai', 'groq', 'openrouter', 'ollama', 'custom'])
    .default('anthropic'),
  model: z.string().max(160).default(''),
  customBaseUrl: z.string().max(300).default(''),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTurns: z.number().int().min(1).max(40).default(12),
  mode: z.enum(['manual', 'auto', 'plan']).default('manual'),
  effort: z.enum(['low', 'medium', 'high']).default('medium'),
  sendOnEnter: z.boolean().default(true),
  sounds: z.boolean().default(true),
  customInstructions: z.string().max(4000).default(''),
  memory: memoryStore.default(memoryStore.parse({})),
  useChatHistory: z.boolean().default(true),
  contextLimit: z.number().int().min(8_000).max(4_000_000).default(500_000),
  agents: z.array(agentProfile).default(defaultAgents),
  usageLog: z.array(usageDay).default([]),
  usagePulse: z.array(usagePulse).default([]),
  showReasoning: z.boolean().default(true),
  studioMcpEnabled: z.boolean().default(true),
  mcpServers: z.array(mcpServer).default([]),
  skills: z.array(skill).default([]),
  spoof: spoofOptions.default(spoofOptions.parse({})),
  onboarded: z.boolean().default(false),
  intent: z.array(z.enum(['build', 'animations'])).default([]),
})
export type Settings = z.infer<typeof settings>

export const runMapping = z.object({ from: z.string(), to: z.string(), name: z.string().default('') })

export const runItem = z.object({
  id: z.string(),
  name: z.string().default(''),
  status: z.string().default(''),
  newId: z.string().default(''),
  reason: z.string().default(''),
  at: z.number().default(0),
})
export type RunItem = z.infer<typeof runItem>

export const runRecord = z.object({
  id: z.string(),
  startedAt: z.number(),
  finishedAt: z.number(),
  stopped: z.boolean().default(false),
  downloadOnly: z.boolean().default(false),
  target: z.string().nullable().default(null),
  done: z.number().default(0),
  failed: z.number().default(0),
  total: z.number().default(0),
  mappings: z.array(runMapping).default([]),
  items: z.array(runItem).default([]),
  applied: z.boolean().default(false),
  label: z.string().default(''),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
})
export type RunRecord = z.infer<typeof runRecord>

export const agentStep = z.object({
  kind: z.enum(['thought', 'tool', 'text', 'artifact', 'memory']).default('tool'),
  id: z.string().default(''),
  status: z.enum(['running', 'done', 'failed']).default('done'),
  name: z.string().default(''),
  target: z.string().default(''),
  source: z.string().default(''),
  text: z.string().default(''),
})
export type AgentStep = z.infer<typeof agentStep>

export const artifact = z.object({
  name: z.string(),
  model: z.string().default(''),
  text: z.string().default(''),
})
export type Artifact = z.infer<typeof artifact>

export const chatMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  actions: z.array(action).default([]),
  reasoning: z.string().default(''),
  steps: z.array(agentStep).default([]),
  images: z.array(z.string()).default([]),
  at: z.number().default(0),
  variants: z.array(z.string()).default([]),
  variant: z.number().default(0),
  artifacts: z.array(artifact).default([]),
  questions: z
    .array(z.object({ text: z.string(), options: z.array(z.string()).default([]) }))
    .default([]),
  resolved: z.boolean().default(false),
  folded: z.boolean().default(false),
  plan: z.object({ title: z.string(), steps: z.array(z.string()).default([]) }).nullable().default(null),
  memories: z.array(z.string()).default([]),
})
export type ChatMessage = z.infer<typeof chatMessage>

export const chatUsage = z.object({
  input: z.number().default(0),
  output: z.number().default(0),
  calls: z.number().default(0),
  lastInput: z.number().default(0),
})
export type ChatUsage = z.infer<typeof chatUsage>

export const conversation = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
  messages: z.array(chatMessage).default([]),
  usage: chatUsage.default(chatUsage.parse({})),
})
export type Conversation = z.infer<typeof conversation>
