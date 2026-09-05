export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'bai'
  | 'groq'
  | 'openrouter'
  | 'ollama'
  | 'custom'

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
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    needsKey: true,
    dialect: 'openai',
    fallbackModels: [],
    hint: 'Huge context and a free tier in AI Studio.',
  },
  {
    id: 'bai',
    label: 'B.AI',
    baseUrl: 'https://api.b.ai/v1',
    keyUrl: 'https://b.ai/',
    needsKey: true,
    dialect: 'openai',
    fallbackModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    hint: 'One key for DeepSeek, GPT, Claude and Gemini. DeepSeek V4 Flash is free while the offer lasts.',
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

export { pickDefaultModel, supportsVision, usableForCode } from './models.ts'
