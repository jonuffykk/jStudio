import { net } from '@/app/lib/ipc'

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
