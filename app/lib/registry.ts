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
