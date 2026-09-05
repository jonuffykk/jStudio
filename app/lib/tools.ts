import type { ToolDef } from '@/app/lib/llm'

export const studioTools: ToolDef[] = [
  {
    name: 'readScript',
    description:
      'Read the full source of a script already in the game. Use it before editing when you do not have the current contents.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Exact path as it appears in the synced tree.' } },
      required: ['path'],
    },
  },
  {
    name: 'writeScript',
    description: 'Create a script or rewrite an existing one. Send the whole file, never a fragment.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'For example ServerScriptService.Combat.DamageHandler' },
        className: { type: 'string', enum: ['Script', 'LocalScript', 'ModuleScript'] },
        source: { type: 'string', description: 'Complete Luau source of the file.' },
        summary: { type: 'string', description: 'One short past tense sentence on what this change does.' },
      },
      required: ['path', 'className', 'source', 'summary'],
    },
  },
  {
    name: 'buildUi',
    description:
      'Build or update a whole screen in one call. Send the tree of the interface and it becomes real GuiObjects in one reviewable, undoable change: layout, corners, strokes, padding, typography and hover states are written for you. Use this for every interface — never build a screen with createInstance.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Where the screen lives, for example StarterGui.Shop.',
        },
        summary: { type: 'string', description: 'One short past tense sentence on what this screen is.' },
        theme: {
          type: 'object',
          description:
            'Optional token overrides, name to hex, for example { "primary": "#FF5C5C" }. Tokens: background, surface, surfaceHigh, line, primary, primaryHover, primaryPressed, onPrimary, text, textDim, textFaint, ok, warn, danger.',
        },
        tree: {
          type: 'object',
          description:
            'The interface. Every node is { class, name?, text?, style?, layout?, props?, states?, children? }. Classes: ScreenGui, Frame, CanvasGroup, ScrollingFrame, TextLabel, TextButton, TextBox, ImageLabel, ImageButton, ViewportFrame. Styles: screen, panel, card, blank, title, subtitle, body, caption, primary, secondary, ghost, danger, input, list, divider, badge. layout is intent, not pixels: { anchor: center, width: fill | hug | { scale, px, min, max }, height: ..., direction: vertical | horizontal | grid, gap, padding, align, justify, cell }. props are real Roblox properties with typed values: a colour is a token name or "#RRGGBB", a UDim is a number or [scale, offset], a UDim2 is [sx, ox, sy, oy], an enum is its name. states is { Hover: {...}, Pressed: {...} } and becomes a small script inside the screen.',
        },
      },
      required: ['path', 'summary', 'tree'],
    },
  },
  {
    name: 'createInstance',
    description:
      'Create or adjust one instance in the world: Part, Model, Folder, SpawnLocation and the like. For interface use buildUi, for logic use writeScript.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'For example Workspace.Arena.Platform' },
        className: { type: 'string', description: 'Exact Roblox class, for example Part, Model, ScreenGui, Frame.' },
        summary: { type: 'string', description: 'One short past tense sentence on what this change does.' },
        position: { type: 'array', items: { type: 'number' }, description: '[x,y,z] in studs.' },
        size: { type: 'array', items: { type: 'number' }, description: '[x,y,z] in studs.' },
        color: { type: 'array', items: { type: 'number' }, description: '[r,g,b] from 0 to 1.' },
        anchored: { type: 'boolean' },
        material: { type: 'string', description: 'Enum.Material name, for example Neon or Wood.' },
        transparency: { type: 'number', description: '0 opaque, 1 invisible.' },
        text: { type: 'string', description: 'Text, for TextLabel and TextButton.' },
        uiSize: { type: 'array', items: { type: 'number' }, description: 'UDim2 [scaleX, offsetX, scaleY, offsetY].' },
        uiPosition: { type: 'array', items: { type: 'number' }, description: 'UDim2 [scaleX, offsetX, scaleY, offsetY].' },
      },
      required: ['path', 'className', 'summary'],
    },
  },
  {
    name: 'deleteInstance',
    description:
      'Propose deleting an instance. Only when the person asked for something to be removed, never to tidy up on your own initiative.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Exact path of what should go.' },
        summary: { type: 'string', description: 'Why this is being removed.' },
      },
      required: ['path', 'summary'],
    },
  },
  {
    name: 'askQuestion',
    description:
      'Ask what you need to know before guessing. Send every open question in one call, up to three, and stop. They answer by picking an option or writing their own. Use it once per turn, not after every step.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'One to three questions, each with the options that would answer it.',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'One short question, in their language.' },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Up to four short answers they can pick with one click.',
              },
            },
            required: ['question'],
          },
        },
      },
      required: ['questions'],
    },
  },
  {
    name: 'remember',
    description:
      'Save what will matter in later conversations: a naming convention, a folder layout, a decision they made, who they are. Send every fact worth keeping in one call. Never save secrets, and never save something said once in passing.',
    parameters: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          items: { type: 'string' },
          description: 'One sentence each, under 200 characters, up to five.',
        },
      },
      required: ['facts'],
    },
  },
  {
    name: 'delegate',
    description:
      'Hand one focused question to a specialist agent the person turned on, and get their reading back. Use it when a request has a side you want a second opinion on, not on every message. You may delegate to at most three in one turn, and a specialist cannot delegate again.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Exact name of one of the agents listed in the prompt.' },
        task: { type: 'string', description: 'The one thing you want them to look at, in full sentences.' },
      },
      required: ['agent', 'task'],
    },
  },
  {
    name: 'searchWeb',
    description:
      'Search the web for what you do not know: a current Roblox API, a limit, a recent change, a library. Send every angle of the question in one call, up to four queries; they run together and come back merged and deduplicated. Follow it with readPages on the addresses worth reading.',
    parameters: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'One to four searches, each a short phrase. Different angles, not the same words reworded.',
        },
      },
      required: ['queries'],
    },
  },
  {
    name: 'readPages',
    description:
      'Read web pages as text, several at once. Use it on the results of searchWeb or on links the person sent. Send every address you want in one call, up to eight; they are fetched in parallel and each one comes back with its title, so cite them by address.',
    parameters: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Full https addresses.',
        },
      },
      required: ['urls'],
    },
  },
  {
    name: 'proposePlan',
    description:
      'Lay out the steps you intend to take and stop for approval. Required in plan mode, and useful on any request big enough that a wrong assumption would cost real work.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What the plan builds, in a few words.' },
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Between two and eight steps, each one short line, in order.',
        },
      },
      required: ['title', 'steps'],
    },
  },
  {
    name: 'respoofAssets',
    description:
      'Re-upload every asset of one kind the place references under the account signed in to jStudio, then swap the new IDs back into the place as one undoable change. Use it when animations, sounds, pictures or meshes do not work because they belong to someone else, or when the person asks to make them theirs. One kind per call.',
    parameters: {
      type: 'object',
      properties: {
        assetKind: {
          type: 'string',
          enum: ['animation', 'audio', 'image', 'mesh'],
          description: 'Which kind to re-upload. Defaults to animation.',
        },
        selectedOnly: { type: 'boolean', description: 'Limit the scan to the current Studio selection.' },
        groupId: { type: 'string', description: 'Upload under this group instead of the user. Digits only.' },
        forceReupload: { type: 'boolean', description: 'Ignore the cache and upload everything again.' },
      },
    },
  },
]

/** Tools whose answer is stable enough to reuse inside one turn. */
export const cacheable = new Set(['readScript', 'searchWeb', 'readPages'])

/** Tools that reach the person or the place, so they are never replayed from cache. */
export const mutating = new Set([
  'writeScript',
  'buildUi',
  'createInstance',
  'deleteInstance',
  'respoofAssets',
  'askQuestion',
  'proposePlan',
  'delegate',
  'remember',
])

/** Tools answered with a card instead of a timeline step. */
export const quiet = new Set(['askQuestion', 'proposePlan', 'remember', 'delegate'])

export const scriptClasses = new Set(['Script', 'LocalScript', 'ModuleScript'])

const MAX_DESCRIPTION = 240
const MAX_FIELD_NOTE = 120
const NOISE = new Set(['$schema', 'title', 'examples', 'default', 'additionalProperties'])

/** Keeps the first sentences that fit, so a tool stays understandable but small. */
export function slimDescription(text: string, limit = MAX_DESCRIPTION): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= limit) return clean

  const cut = clean.slice(0, limit)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '))
  return (stop > limit * 0.5 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`).trim()
}

/**
 * Strips what a model never reads from a JSON schema and shortens the prose in
 * it. The shape stays valid; only the padding leaves.
 */
export function slimSchema(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => slimSchema(entry, depth + 1))
  if (typeof value !== 'object' || value === null) return value
  if (depth > 6) return {}

  const output: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (NOISE.has(key)) continue

    if (key === 'description' && typeof entry === 'string') {
      const note = slimDescription(entry, depth === 0 ? MAX_DESCRIPTION : MAX_FIELD_NOTE)
      if (note) output[key] = note
      continue
    }

    output[key] = slimSchema(entry, depth + 1)
  }

  return output
}

export const toolSize = (tools: { name: string; description: string; parameters: unknown }[]) =>
  Math.ceil(JSON.stringify(tools).length / 4)
