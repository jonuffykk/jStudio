export type ProviderId = 'anthropic' | 'openai' | 'groq' | 'openrouter' | 'ollama' | 'custom'

export type Provider = {
  id: ProviderId
  label: string
  baseUrl: string
  keyUrl: string
  needsKey: boolean
  dialect: 'anthropic' | 'openai'
  fallbackModels: string[]
  hint: string
}

export const providers: Provider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    needsKey: true,
    dialect: 'anthropic',
    fallbackModels: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    hint: 'Best results on long Luau and refactors. Pay per use.',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    needsKey: true,
    dialect: 'openai',
    fallbackModels: [],
    hint: 'The fastest, with a free tier and no card. Start here if you have no key.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    needsKey: true,
    dialect: 'openai',
    fallbackModels: [],
    hint: 'Solid all rounder. Pay per use.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    needsKey: true,
    dialect: 'openai',
    fallbackModels: [],
    hint: 'One key for hundreds of models, some of them free.',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    keyUrl: 'https://ollama.com/download',
    needsKey: false,
    dialect: 'openai',
    fallbackModels: [],
    hint: 'Runs on your machine. No key and no cost, in exchange for a weaker model.',
  },
  {
    id: 'custom',
    label: 'Custom endpoint',
    baseUrl: '',
    keyUrl: '',
    needsKey: true,
    dialect: 'openai',
    fallbackModels: [],
    hint: 'Anything that speaks /chat/completions: LM Studio, vLLM, Together, your own gateway.',
  },
]

export const findProvider = (id: ProviderId): Provider =>
  providers.find((provider) => provider.id === id) ?? providers[0]!

const notForCode =
  /whisper|tts|text-to-speech|embed|moderation|guard|playai|orpheus|dall-e|stable-diffusion|rerank|sora|image|vision-only/i

export const usableForCode = (model: string) => !notForCode.test(model)

const preference = [
  /claude-opus-5/i,
  /claude-sonnet-5/i,
  /gpt-5/i,
  /gpt-oss-120b/i,
  /qwen.*coder/i,
  /llama-3\.3-70b/i,
]

export function pickDefaultModel(models: string[]): string {
  for (const pattern of preference) {
    const match = models.find((model) => pattern.test(model))
    if (match) return match
  }
  return models[0] ?? ''
}
