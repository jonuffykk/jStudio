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

const extent = z.union([
  z.literal('fill'),
  z.literal('hug'),
  z.object({
    scale: z.number().min(0).max(1).optional(),
    px: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
])

export const uiLayout = z.object({
  anchor: z
    .enum(['topLeft', 'top', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottom', 'bottomRight'])
    .optional(),
  width: extent.optional(),
  height: extent.optional(),
  direction: z.enum(['vertical', 'horizontal', 'grid']).optional(),
  gap: z.number().min(0).max(200).optional(),
  padding: z.union([z.number(), z.tuple([z.number(), z.number(), z.number(), z.number()])]).optional(),
  align: z.enum(['start', 'center', 'end']).optional(),
  justify: z.enum(['start', 'center', 'end']).optional(),
  cell: z.tuple([z.number(), z.number()]).optional(),
})

const properties = z.record(z.string().max(40), z.unknown())

export type UiNode = {
  class: string
  name?: string
  text?: string
  style?: string
  props?: Record<string, unknown>
  layout?: z.infer<typeof uiLayout>
  states?: Record<string, Record<string, unknown>>
  children?: UiNode[]
}

export const uiNode: z.ZodType<UiNode> = z.lazy(() =>
  z.object({
    class: z.string().min(1).max(40).regex(/^[A-Za-z][A-Za-z0-9]*$/, 'Invalid class name'),
    name: z.string().max(60).optional(),
    text: z.string().max(2000).optional(),
    style: z.string().max(40).optional(),
    props: properties.optional(),
    layout: uiLayout.optional(),
    states: z.record(z.string().max(20), properties).optional(),
    children: z.array(uiNode).max(60).optional(),
  })
)

export const uiAction = z.object({
  kind: z.literal('ui'),
  path: instancePath,
  summary: z.string().min(1).max(240),
  tree: uiNode,
  theme: z.record(z.string().max(40), z.string().max(40)).optional(),
})

export const action = z.discriminatedUnion('kind', [
  scriptAction,
  instanceAction,
  deleteAction,
  uiAction,
])
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
  studioUserId: z.string().nullable().default(null),
  creatorId: z.string().nullable().default(null),
  creatorType: z.string().nullable().default(null),
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
  paired: z.boolean().default(false),
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
  assetKind: z.enum(['animation', 'audio', 'image', 'mesh']).default('animation'),
})
export type SpoofOptions = z.infer<typeof spoofOptions>
export type AssetKind = SpoofOptions['assetKind']

export const memoryItem = z.object({
  id: z.string(),
  text: z.string().max(400),
  at: z.number().default(0),
})
export type MemoryItem = z.infer<typeof memoryItem>

export const profile = z.object({
  nickname: z.string().max(40).default(''),
  role: z
    .enum(['none', 'solo', 'studio', 'scripter', 'artist', 'builder', 'learning'])
    .default('none'),
})
export type Profile = z.infer<typeof profile>

export const memoryStore = z.object({
  enabled: z.boolean().default(true),
  items: z.array(memoryItem).default([]),
})

export const usageSource = z.enum(['chat', 'title', 'agent', 'summary'])
export type UsageSource = z.infer<typeof usageSource>

export const usageDay = z.object({
  day: z.string(),
  input: z.number().default(0),
  output: z.number().default(0),
  runs: z.number().default(0),
  cost: z.number().default(0),
  bySource: z.partialRecord(usageSource, z.number()).default({}),
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
    .enum(['anthropic', 'openai', 'gemini', 'bai', 'groq', 'openrouter', 'ollama', 'custom'])
    .default('anthropic'),
  model: z.string().max(160).default(''),
  customBaseUrl: z.string().max(300).default(''),
  mode: z.enum(['manual', 'auto', 'plan']).default('manual'),
  effort: z.enum(['low', 'medium', 'high']).default('medium'),
  sendOnEnter: z.boolean().default(true),
  approval: z.enum(['ask', 'auto']).default('ask'),
  allowedTools: z.array(z.string().max(80)).default([]),
  sounds: z.boolean().default(true),
  customInstructions: z.string().max(4000).default(''),
  profile: profile.default(profile.parse({})),
  memory: memoryStore.default(memoryStore.parse({})),
  useChatHistory: z.boolean().default(true),
  subagents: z.boolean().default(false),
  contextLimit: z.number().int().min(8_000).max(4_000_000).default(500_000),
  showReasoning: z.boolean().default(true),
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
  detail: z.string().default(''),
  free: z.boolean().default(false),
  at: z.number().default(0),
})
export type RunItem = z.infer<typeof runItem>

export const runRecord = z.object({
  id: z.string(),
  startedAt: z.number(),
  finishedAt: z.number(),
  stopped: z.boolean().default(false),
  downloadOnly: z.boolean().default(false),
  assetKind: z.enum(['animation', 'audio', 'image', 'mesh']).default('animation'),
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
  thinkMs: z.number().default(0),
  replyMs: z.number().default(0),
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
  model: z.string().max(160).default(''),
  updatedAt: z.number(),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
  messages: z.array(chatMessage).default([]),
  usage: chatUsage.default(chatUsage.parse({})),
})
export type Conversation = z.infer<typeof conversation>
