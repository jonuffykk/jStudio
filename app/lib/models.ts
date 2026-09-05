export type Reasoning = 'none' | 'effort' | 'budget'

export type Capability = {
  contextWindow: number
  maxOutput: number
  vision: boolean
  reasoning: Reasoning
  tools: boolean
  code: boolean
}

/** What a provider tells us about one model. Prices are USD per million tokens. */
export type ModelInfo = Capability & {
  id: string
  label: string
  inputPrice: number | null
  outputPrice: number | null
  free: boolean
}

/** Unknown models are treated as capable: a refusal is recoverable, a false block is not. */
const fallback: Capability = {
  contextWindow: 128_000,
  maxOutput: 8_192,
  vision: true,
  reasoning: 'none',
  tools: true,
  code: true,
}

type Rule = { match: RegExp; capability: Partial<Capability> }

const rules: Rule[] = [
  {
    match: /claude-(opus|sonnet)-[45]|claude-3-7-sonnet/i,
    capability: { contextWindow: 200_000, maxOutput: 32_000, vision: true, reasoning: 'budget' },
  },
  {
    match: /claude-haiku-4|claude-3-5-haiku/i,
    capability: { contextWindow: 200_000, maxOutput: 8_192, vision: true, reasoning: 'budget' },
  },
  {
    match: /claude-3-5-sonnet/i,
    capability: { contextWindow: 200_000, maxOutput: 8_192, vision: true, reasoning: 'none' },
  },
  {
    match: /gpt-5/i,
    capability: { contextWindow: 400_000, maxOutput: 32_000, vision: true, reasoning: 'effort' },
  },
  {
    match: /^o[34](-|$)/i,
    capability: { contextWindow: 200_000, maxOutput: 32_000, vision: true, reasoning: 'effort' },
  },
  {
    match: /gpt-4o-mini/i,
    capability: { contextWindow: 128_000, maxOutput: 16_384, vision: true, reasoning: 'none' },
  },
  {
    match: /gpt-4o|gpt-4\.1/i,
    capability: { contextWindow: 128_000, maxOutput: 16_384, vision: true, reasoning: 'none' },
  },
  {
    match: /gemini-[0-9.]+-(pro|flash)/i,
    capability: { contextWindow: 1_000_000, maxOutput: 32_000, vision: true, reasoning: 'effort' },
  },
  {
    match: /glm-[0-9.]+/i,
    capability: { contextWindow: 128_000, maxOutput: 16_384, vision: false, reasoning: 'effort' },
  },
  {
    match: /deepseek.*(reasoner|r1)|qwq|thinking/i,
    capability: { contextWindow: 128_000, maxOutput: 16_384, vision: false, reasoning: 'effort' },
  },
  {
    match: /deepseek/i,
    capability: { contextWindow: 128_000, maxOutput: 16_384, vision: false, reasoning: 'none' },
  },
  {
    match: /llama-4|pixtral|-vl-|\bvl\b|internvl|glm-4v|minicpm-v|molmo|grok-[0-9]/i,
    capability: { vision: true },
  },
  {
    match: /gpt-oss|kimi|codestral|codellama|starcoder|granite-code|nemotron|command-r|qwen[\d.]*-?(coder|max|turbo|plus)/i,
    capability: { vision: false },
  },
  {
    match: /whisper|tts|text-to-speech|embed|moderation|guard|playai|orpheus|dall-e|stable-diffusion|rerank|sora|^image|-image/i,
    capability: { code: false, tools: false },
  },
]

export function capabilityOf(model: string): Capability {
  return rules
    .filter((rule) => rule.match.test(model))
    .reduce<Capability>((merged, rule) => ({ ...merged, ...rule.capability }), fallback)
}

const freeModel = /:free|-free/i
export const isFreeModel = (model: string) => freeModel.test(model)

export const supportsVision = (model: string) => (model ? capabilityOf(model).vision : true)
export const usableForCode = (model: string) => capabilityOf(model).code

export function describeModel(id: string): ModelInfo {
  return {
    id,
    label: id,
    ...capabilityOf(id),
    inputPrice: null,
    outputPrice: null,
    free: isFreeModel(id),
  }
}

type RawModel = {
  id?: string
  name?: string
  context_window?: number
  context_length?: number
  active?: boolean
  architecture?: { input_modalities?: string[] }
  supported_parameters?: string[]
  top_provider?: { max_completion_tokens?: number | null }
  pricing?: { prompt?: string; completion?: string }
}

const perMillion = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed * 1_000_000 : null
}

/**
 * Turns one provider's model listing into what the app shows. Only fields the
 * provider actually sent are trusted; everything else falls back to the table.
 */
export function readModel(raw: RawModel): ModelInfo | null {
  const id = raw.id
  if (!id || raw.active === false) return null

  const base = capabilityOf(id)
  const parameters = raw.supported_parameters ?? []
  const modalities = raw.architecture?.input_modalities

  const input = perMillion(raw.pricing?.prompt)
  const output = perMillion(raw.pricing?.completion)

  return {
    id,
    label: raw.name ?? id,
    contextWindow: raw.context_length ?? raw.context_window ?? base.contextWindow,
    maxOutput: raw.top_provider?.max_completion_tokens ?? base.maxOutput,
    vision: modalities ? modalities.includes('image') : base.vision,
    reasoning: parameters.includes('reasoning')
      ? 'effort'
      : parameters.length > 0
        ? 'none'
        : base.reasoning,
    tools: parameters.length > 0 ? parameters.includes('tools') : base.tools,
    code: base.code,
    inputPrice: input,
    outputPrice: output,
    free: isFreeModel(id) || (input === 0 && output === 0),
  }
}

export function findModel(catalog: ModelInfo[], id: string): ModelInfo {
  return catalog.find((entry) => entry.id === id) ?? describeModel(id)
}

/** Dollars for one exchange, or null when the provider publishes no price. */
export function costOf(model: ModelInfo, input: number, output: number): number | null {
  if (model.inputPrice === null || model.outputPrice === null) return null
  return (input * model.inputPrice + output * model.outputPrice) / 1_000_000
}

export function formatCost(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(4)}`
}

export function formatPrice(value: number): string {
  if (value === 0) return 'free'
  if (value >= 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(2).replace(/0$/, '')}`
}

export function formatContext(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`
  return `${Math.round(value / 1000)}k`
}

const preference = [/claude-opus-5/i, /claude-sonnet-5/i, /gpt-5/i, /gpt-oss-120b/i, /qwen.*coder/i]

export function pickDefaultModel(models: string[]): string {
  for (const pattern of preference) {
    const match = models.find((model) => pattern.test(model))
    if (match) return match
  }
  return models[0] ?? ''
}

/** Groups by vendor prefix, the way every provider names its catalogue. */
export function groupModels(models: ModelInfo[]): { label: string; models: ModelInfo[] }[] {
  const groups = new Map<string, ModelInfo[]>()

  for (const model of models) {
    const name = model.id.includes('/')
      ? (model.id.split('/')[0] ?? 'other')
      : (model.id.split(/[-.]/)[0] ?? 'other')
    const label = name.charAt(0).toUpperCase() + name.slice(1)
    groups.set(label, [...(groups.get(label) ?? []), model])
  }

  return [...groups.entries()]
    .map(([label, entries]) => ({
      label,
      models: entries.sort((left, right) => left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
}
