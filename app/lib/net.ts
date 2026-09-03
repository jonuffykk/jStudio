import { net } from '@/app/lib/ipc'
import { catalog, type CatalogEntry } from '@/app/lib/schemas'

export const builtinCatalog: CatalogEntry[] = [
  {
    id: 'context7',
    name: 'Context7',
    kind: 'mcp',
    description: 'Up to date documentation for libraries and frameworks, fetched on demand.',
    transport: 'http',
    url: 'https://mcp.context7.com/mcp',
    command: '',
    args: [],
    instructions: '',
    homepage: 'https://context7.com',
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    kind: 'mcp',
    description: 'Ask questions about any public GitHub repository.',
    transport: 'http',
    url: 'https://mcp.deepwiki.com/mcp',
    command: '',
    args: [],
    instructions: '',
    homepage: 'https://deepwiki.com',
  },
]

export async function importCatalog(url: string): Promise<CatalogEntry[]> {
  const response = await net(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status} from that URL.`)

  const body = await response.text()
  let data: unknown

  try {
    data = JSON.parse(body)
  } catch {
    throw new Error('That URL answered with a page, not a manifest. Link the raw JSON file.')
  }

  const parsed = catalog.safeParse(data)
  if (!parsed.success) {
    throw new Error('That JSON is not a jStudio manifest. It needs a name and an entries array.')
  }

  return parsed.data.entries
}

const MAX_PAGE = 12_000

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

export async function readPage(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http and https addresses can be read.')

  const response = await net(url, { headers: { Accept: 'text/html,text/plain' } })
  if (!response.ok) throw new Error(`HTTP ${response.status} from that page.`)

  const body = await response.text()
  const text = /<\w+[\s>]/.test(body.slice(0, 500)) ? stripHtml(body) : body.trim()
  return text.slice(0, MAX_PAGE)
}

export async function searchWeb(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const response = await net(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { Accept: 'text/html' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} from the search.`)

  const body = await response.text()
  const results: { title: string; url: string; snippet: string }[] = []
  const pattern =
    /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  for (const match of body.matchAll(pattern)) {
    const raw = match[1] ?? ''
    const direct = /uddg=([^&]+)/.exec(raw)
    results.push({
      url: direct?.[1] ? decodeURIComponent(direct[1]) : raw,
      title: stripHtml(match[2] ?? ''),
      snippet: stripHtml(match[3] ?? ''),
    })
    if (results.length >= 8) break
  }

  return results
}
