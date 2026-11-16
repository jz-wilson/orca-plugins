// A minimal MCP client over HTTP: initialize, then call `list_tasks` page by page. The token goes
// only to the URL it is given, only in the Authorization header, and never into an error message.
import { parseRpcBody, parseTaskPage, sortTasks, type Task } from './helpin'

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * The only errors whose text may reach the panel or the log. Anything else (a network or header
 * error from fetch) can quote what was sent, the token included, so callers replace it.
 */
export class HelpinError extends Error {}

export function helpinMessage(error: unknown): string {
  return error instanceof HelpinError ? error.message : 'Could not reach Helpin'
}

const PROTOCOL = '2025-03-26'
const TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 2_000_000
const MAX_PAGES = 20
const MAX_TASKS = 2000

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new HelpinError('The response was too large')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

type Session = { post(body: unknown): Promise<unknown>; close(): Promise<void> }

async function open(url: string, token: string, doFetch: Fetch): Promise<Session> {
  let sessionId: string | undefined
  const headers = (): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL,
    ...(sessionId ? { 'mcp-session-id': sessionId } : {})
  })
  const post = async (body: unknown): Promise<unknown> => {
    const response = await doFetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      // A redirect would send the request somewhere the person never configured.
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    sessionId ??= response.headers.get('mcp-session-id') ?? undefined
    if (response.status === 401 || response.status === 403) throw new HelpinError('Helpin rejected the token')
    if (!response.ok) throw new HelpinError(`Helpin answered HTTP ${response.status}`)
    const text = await readCapped(response)
    if (response.status === 202 || text === '') return undefined
    return parseRpcBody(response.headers.get('content-type') ?? '', text)
  }
  const reply = (await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'orca-helpin-tasks', version: '0.1.0' } }
  })) as { error?: { message?: string } } | undefined
  if (reply?.error) throw new HelpinError('Helpin refused the connection')
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return {
    post,
    async close() {
      if (!sessionId) return
      await doFetch(url, { method: 'DELETE', headers: headers(), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => undefined)
    }
  }
}

/** Every open task whose key starts with `prefix`, most urgent first. */
export async function listOpenTasks(
  url: string,
  token: string,
  prefix: string,
  doFetch: Fetch = fetch
): Promise<Task[]> {
  const session = await open(url, token, doFetch)
  try {
    const tasks: Task[] = []
    let offset: number | null = 0
    for (let page = 0; offset !== null && page < MAX_PAGES; page++) {
      const reply = (await session.post({
        jsonrpc: '2.0',
        id: 2 + page,
        method: 'tools/call',
        params: {
          name: 'list_tasks',
          arguments: { open_only: true, detail_level: 'summary', limit: 100, offset }
        }
      })) as
        | { error?: unknown; result?: { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] } }
        | undefined
      if (reply?.error || reply?.result?.isError) throw new HelpinError('Helpin could not list tasks')
      // The structured reply is the data itself; the text is the same data after a sentence.
      const structured = reply?.result?.structuredContent
      const text = reply?.result?.content?.find((block) => block.type === 'text')?.text
      const source = structured && typeof structured === 'object' ? structured : text
      if (!source) throw new HelpinError('Helpin sent no task list')
      let parsed: ReturnType<typeof parseTaskPage>
      try {
        parsed = parseTaskPage(source, prefix)
      } catch {
        throw new HelpinError('Helpin sent a task list in an unexpected shape')
      }
      tasks.push(...parsed.tasks)
      if (tasks.length >= MAX_TASKS) break
      offset = parsed.next !== null && parsed.next > offset ? parsed.next : null
    }
    return sortTasks(tasks.slice(0, MAX_TASKS))
  } finally {
    await session.close()
  }
}
