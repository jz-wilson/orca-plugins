import { assert, test } from 'orca/testing'
import { claudeAdapter, claudeLifetimeFromText, FIVE_MINUTES_MS, ONE_HOUR_MS } from './adapters'

const entry = (cc: Record<string, number> | null, extra = {}) =>
  JSON.stringify({ message: { usage: { ...(cc ? { cache_creation: cc } : {}), ...extra } } })

test('a 1-hour cache write means a 1-hour lifetime', () => {
  const text = entry({ ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1200 })
  assert.equal(claudeLifetimeFromText(text), ONE_HOUR_MS)
})

test('a 5-minute cache write means a 5-minute lifetime', () => {
  const text = entry({ ephemeral_5m_input_tokens: 900, ephemeral_1h_input_tokens: 0 })
  assert.equal(claudeLifetimeFromText(text), FIVE_MINUTES_MS)
})

test('the newest entry that wrote to the cache wins, and read-only entries are skipped', () => {
  const text = [
    entry({ ephemeral_5m_input_tokens: 900, ephemeral_1h_input_tokens: 0 }),
    entry({ ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 40 }),
    entry({ ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, { cache_read_input_tokens: 5 })
  ].join('\n')
  assert.equal(claudeLifetimeFromText(text), ONE_HOUR_MS)
})

test('a cut-off first line and unrelated lines are ignored', () => {
  const text = ['{"message":{"usage":{"cache_creat', '{"type":"user"}', entry({ ephemeral_1h_input_tokens: 7 })].join('\n')
  assert.equal(claudeLifetimeFromText(text), ONE_HOUR_MS)
})

test('no cache write means unknown, not a guess', () => {
  assert.equal(claudeLifetimeFromText(entry(null, { input_tokens: 3 })), null)
  assert.equal(claudeLifetimeFromText(''), null)
})

test('the adapter reads through the injected transcript tail', async () => {
  const adapter = claudeAdapter(async (id) =>
    id === 'abc12345' ? entry({ ephemeral_1h_input_tokens: 10 }) : null
  )
  assert.equal(adapter.agent, 'claude')
  assert.equal(await adapter.lifetimeMs('abc12345'), ONE_HOUR_MS)
  assert.equal(await adapter.lifetimeMs('missing00'), null)
})
