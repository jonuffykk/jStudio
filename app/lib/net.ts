const transport = async (url: string, init?: RequestInit): Promise<Response> =>
  (await import('@/app/lib/ipc')).net(url, init)

const MAX_PAGE = 12_000
const MAX_BYTES = 1_500_000
const TIMEOUT_MS = 15_000
const BATCH = 4

/** Sites answer a browser and refuse a script, so the request looks like one. */
const BROWSER = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'en,pt;q=0.8,es;q=0.6',
}

export type Source = { url: string; title: string; text: string; ok: boolean; error?: string }
export type Hit = { title: string; url: string; snippet: string; source: string }

const entities: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
}

const decode = (text: string) =>
  text.replace(/&(#?\w+);/g, (whole, name: string) => {
    if (entities[name]) return entities[name]
    if (name.startsWith('#')) {
      const code = Number(name.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return whole
  })

/** Keeps the article and drops the furniture: script, style, nav, header, footer, aside. */
export function readable(html: string): { title: string; text: string } {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim()

  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|pre|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<h([1-6])[^>]*>/gi, '\n#')
    .replace(/<[^>]+>/g, ' ')

  const text = decode(body)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { title, text }
}

/**
 * Reads the whole body and trims afterwards. Cancelling a stream mid flight
 * leaves the host holding a resource nobody owns, which surfaces later as an
 * unhandled rejection, so this never cancels.
 */
async function fetchText(url: string, accept: string): Promise<string> {
  /**
   * The timer is cleared the moment the request settles. An abort that fires
   * afterwards would cancel a resource the host already dropped, and that
   * arrives later as a rejection nobody owns.
   */
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await transport(url, {
      headers: { ...BROWSER, Accept: accept },
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const type = response.headers.get('content-type') ?? ''
    if (type && !/text|html|json|xml|markdown|javascript/i.test(type)) {
      throw new Error(`that address serves ${type.split(';')[0]}, not a page`)
    }

    return (await response.text()).slice(0, MAX_BYTES)
  } finally {
    clearTimeout(timer)
  }
}

/** Reads one page as text, retrying once with a looser Accept before giving up. */
export async function readPage(url: string): Promise<Source> {
  const address = url.trim()
  if (!/^https?:\/\//i.test(address)) {
    return { url: address, title: '', text: '', ok: false, error: 'only http and https addresses can be read' }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body = await fetchText(address, attempt === 0 ? 'text/html,text/plain;q=0.9,*/*;q=0.8' : '*/*')
      const looksHtml = /<\w+[\s>]/.test(body.slice(0, 1000))
      const { title, text } = looksHtml ? readable(body) : { title: '', text: body.trim() }

      if (!text) throw new Error('that page came back empty')
      return { url: address, title, text: text.slice(0, MAX_PAGE), ok: true }
    } catch (error) {
      if (attempt === 1) {
        return {
          url: address,
          title: '',
          text: '',
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
  }

  return { url: address, title: '', text: '', ok: false, error: 'unreachable' }
}

/** Reads many pages at once, a few at a time, and never rejects. */
export async function readPages(urls: string[]): Promise<Source[]> {
  const wanted = [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, 8)
  const out: Source[] = []

  for (let index = 0; index < wanted.length; index += BATCH) {
    out.push(...(await Promise.all(wanted.slice(index, index + BATCH).map(readPage))))
  }

  return out
}

const unwrap = (href: string) => {
  const wrapped = /[?&]uddg=([^&]+)/.exec(href)
  if (wrapped?.[1]) return decodeURIComponent(wrapped[1])

  const bing = /[?&]u=a1([^&]+)/.exec(href)
  if (bing?.[1]) {
    try {
      return atob(bing[1].replace(/-/g, '+').replace(/_/g, '/'))
    } catch {
      return href
    }
  }

  return href.startsWith('//') ? `https:${href}` : href
}

const clean = (html: string) => readable(html).text.replace(/\s+/g, ' ').trim()

type Engine = { name: string; url: (query: string) => string; parse: (body: string) => Hit[] }

/** Four independent engines, each with its own shape. Whatever answers, answers. */
const engines: Engine[] = [
  {
    name: 'duckduckgo',
    url: (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    parse: (body) =>
      [
        ...body.matchAll(
          /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
        ),
      ].map((match) => ({
        url: unwrap(match[1] ?? ''),
        title: clean(match[2] ?? ''),
        snippet: clean(match[3] ?? ''),
        source: 'duckduckgo',
      })),
  },
  {
    name: 'duckduckgo-lite',
    url: (query) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    parse: (body) =>
      [...body.matchAll(/<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(
        (match) => ({
          url: unwrap(match[1] ?? ''),
          title: clean(match[2] ?? ''),
          snippet: '',
          source: 'duckduckgo',
        })
      ),
  },
  {
    name: 'mojeek',
    url: (query) => `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`,
    parse: (body) =>
      [
        ...body.matchAll(
          /<a[^>]+class="ob"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p class="s">([\s\S]*?)<\/p>/g
        ),
      ].map((match) => ({
        url: unwrap(match[1] ?? ''),
        title: clean(match[2] ?? ''),
        snippet: clean(match[3] ?? ''),
        source: 'mojeek',
      })),
  },
  {
    name: 'bing',
    url: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`,
    parse: (body) =>
      [
        ...body.matchAll(
          /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g
        ),
      ].map((match) => ({
        url: unwrap(match[1] ?? ''),
        title: clean(match[2] ?? ''),
        snippet: clean(match[3] ?? ''),
        source: 'bing',
      })),
  },
]

/** Wikipedia answers with JSON and no key, which makes it the one source that never breaks. */
async function encyclopedia(query: string, language: string): Promise<Hit[]> {
  const url =
    `https://${language}.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*` +
    `&srlimit=3&srsearch=${encodeURIComponent(query)}`

  try {
    const body = JSON.parse(await fetchText(url, 'application/json')) as {
      query?: { search?: { title: string; snippet: string }[] }
    }

    return (body.query?.search ?? []).map((entry) => ({
      title: entry.title,
      url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(entry.title.replace(/ /g, '_'))}`,
      snippet: clean(entry.snippet),
      source: 'wikipedia',
    }))
  } catch {
    return []
  }
}

const looksBlocked = (hits: Hit[]) => hits.length === 0

/** Every engine, at the same time, for one query. */
export async function searchOnce(query: string, language = 'en'): Promise<Hit[]> {
  const rounds = await Promise.all([
    ...engines.map(async (engine) => {
      try {
        const hits = engine.parse(await fetchText(engine.url(query), 'text/html'))
        return looksBlocked(hits) ? [] : hits
      } catch {
        return []
      }
    }),
    encyclopedia(query, language),
  ])

  return interleave(rounds)
}

/** Round robin across sources so no single engine takes the whole page. */
function interleave(rounds: Hit[][], limit = 10): Hit[] {
  const seen = new Set<string>()
  const merged: Hit[] = []
  const depth = Math.max(0, ...rounds.map((hits) => hits.length))

  for (let rank = 0; rank < depth && merged.length < limit; rank++) {
    for (const hits of rounds) {
      const hit = hits[rank]
      if (!hit?.url || !/^https?:\/\//i.test(hit.url) || seen.has(hit.url)) continue

      seen.add(hit.url)
      merged.push(hit)
      if (merged.length >= limit) break
    }
  }

  return merged
}

/**
 * Several queries and every engine at once, merged and deduplicated by address.
 * Asking three angles in one turn beats three turns asking one each.
 */
export async function searchWeb(queries: string[], language = 'en'): Promise<Hit[]> {
  const wanted = [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 4)
  const rounds = await Promise.all(wanted.map((query) => searchOnce(query, language)))
  return interleave(rounds, 12)
}
