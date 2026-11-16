import { assert, test } from 'orca/testing'
import { HelpinError, helpinMessage, listOpenTasks, type Fetch } from './mcp'

const TOKEN = 'secret-token-123'
const URL_ = 'https://helpin.example.com/mcp'

type Call = { method: string; headers: Record<string, string>; body: { method?: string; params?: { arguments?: { offset?: number } } } | null }

function page(tasks: unknown[], next: number | null): string {
  return JSON.stringify({ data: { tasks, has_more: next !== null, next_offset: next } })
}

function server(pages: string[], calls: Call[]): Fetch {
  return async (_url, init) => {
    const headers = init.headers as Record<string, string>
    const body = init.body ? JSON.parse(String(init.body)) : null
    calls.push({ method: String(init.method), headers, body })
    if (init.method === 'DELETE') return new Response(null, { status: 200 })
    if (body.method === 'initialize') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' }
      })
    }
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const text = pages[(body.params.arguments.offset ?? 0) / 100] ?? page([], null)
    // Like the real server: a sentence before the JSON in the text, and the data again as structuredContent.
    const structured = text.startsWith('{') ? JSON.parse(text) : undefined
    const message = JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: { content: [{ type: 'text', text: structured ? `List tasks completed.\n\n${text}` : text }], ...(structured ? { structuredContent: structured } : {}) }
    })
    // The second page arrives as an event stream, as some MCP servers send it.
    const stream = body.params.arguments.offset === 100
    return new Response(stream ? `event: message\ndata: ${message}\n\n` : message, {
      headers: { 'content-type': stream ? 'text/event-stream' : 'application/json' }
    })
  }
}

const task = (key: string, priority = 'medium') => ({ task_key: key, task_id: `id-${key}`, name: `Task ${key}`, state_name: 'Todo', priority })

test('lists every page, filters by prefix, sorts, and sends the token only as a bearer header', async () => {
  const calls: Call[] = []
  const found = await listOpenTasks(URL_, TOKEN, 'ABC-', server([page([task('ABC-1'), task('X-9')], 100), page([task('ABC-2', 'urgent')], null)], calls))
  assert.deepEqual(found.map((t) => t.key), ['ABC-2', 'ABC-1'])
  for (const call of calls) assert.equal(call.headers.authorization, `Bearer ${TOKEN}`)
  assert.equal(calls.some((c) => JSON.stringify(c.body).includes(TOKEN)), false)
  const afterInit = calls.filter((c) => c.body?.method !== 'initialize')
  assert.equal(afterInit.every((c) => c.headers['mcp-session-id'] === 'sess-1'), true)
  assert.equal(calls.at(-1)?.method, 'DELETE')
})

test('an unauthorized response fails without echoing the token', async () => {
  const refuse: Fetch = async () => new Response('unauthorized', { status: 401 })
  await assert.rejects(listOpenTasks(URL_, TOKEN, '', refuse), (error: unknown) => {
    const text = String((error as Error).message)
    assert.equal(text, 'Helpin rejected the token')
    assert.equal(text.includes(TOKEN), false)
    return true
  })
})

test('a server error, a tool error and an empty answer each fail with a plain message', async () => {
  const down: Fetch = async () => new Response('x', { status: 503 })
  await assert.rejects(listOpenTasks(URL_, TOKEN, '', down), /HTTP 503/)
  await assert.rejects(listOpenTasks(URL_, TOKEN, '', down), (e: unknown) => e instanceof HelpinError)

  const toolError: Fetch = async (_u, init) => {
    const body = init.body ? JSON.parse(String(init.body)) : {}
    if (body.method === 'tools/call') {
      return new Response(JSON.stringify({ result: { isError: true, content: [{ type: 'text', text: `boom ${TOKEN}` }] } }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response(body.method === 'initialize' ? '{"result":{}}' : null, { status: body.method === 'initialize' ? 200 : 202, headers: { 'content-type': 'application/json' } })
  }
  await assert.rejects(listOpenTasks(URL_, TOKEN, '', toolError), (error: unknown) => {
    assert.equal((error as Error).message, 'Helpin could not list tasks')
    return true
  })
})

test('redirects are refused on every request', async () => {
  const modes: (RequestRedirect | undefined)[] = []
  const calls: Call[] = []
  const inner = server([page([task('ABC-1')], null)], calls)
  const spy: Fetch = (url, init) => {
    modes.push(init.redirect)
    return inner(url, init)
  }
  await listOpenTasks(URL_, TOKEN, '', spy)
  assert.equal(modes.length > 3, true)
  assert.equal(modes.every((m) => m === 'error'), true) // POSTs and the closing DELETE
})

test('a network or header error never reaches the caller as text that could quote the token', async () => {
  const quoting: Fetch = async (_u, init) => {
    throw new TypeError(`Headers.append: "${(init.headers as Record<string, string>).authorization}" is an invalid header value.`)
  }
  await assert.rejects(listOpenTasks(URL_, TOKEN, '', quoting), (error: unknown) => {
    assert.equal(helpinMessage(error), 'Could not reach Helpin')
    return true
  })
  assert.equal(helpinMessage(new HelpinError('Helpin rejected the token')), 'Helpin rejected the token')
})

test('a task list in an unexpected shape fails with a plain message', async () => {
  const calls: Call[] = []
  const weird = server(['not json at all'], calls)
  await assert.rejects(listOpenTasks(URL_, TOKEN, '', weird), (error: unknown) => {
    assert.equal(helpinMessage(error), 'Helpin sent a task list in an unexpected shape')
    return true
  })
})

test('an oversized response is refused', async () => {
  const huge: Fetch = async () => new Response('x'.repeat(2_100_000), { headers: { 'content-type': 'application/json' } })
  await assert.rejects(listOpenTasks(URL_, TOKEN, '', huge), /too large/)
})
