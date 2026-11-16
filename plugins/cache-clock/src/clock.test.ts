import { assert, test } from 'orca/testing'
import { CACHE_TTL_MS, view } from './clock'

test('warm: shows a full bar and the time left', () => {
  const v = view(0, 0)
  assert.equal(v.text, 'cache ▰▰▰▰▰▰▰▰ 5:00')
  assert.equal(v.tone, 'success')
})

test('last quarter turns warning', () => {
  const v = view(0, CACHE_TTL_MS - 60_000)
  assert.equal(v.text, 'cache ▰▰▱▱▱▱▱▱ 1:00')
  assert.equal(v.tone, 'warning')
})

test('cold: counts up since expiry', () => {
  const v = view(0, CACHE_TTL_MS + 90_000)
  assert.equal(v.text, 'cache cold 1:30 ago')
  assert.equal(v.tone, 'danger')
})
