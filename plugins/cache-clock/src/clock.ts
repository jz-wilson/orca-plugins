// Pure countdown logic, kept apart from the worker so Node tests can run it.
export const CACHE_TTL_MS = 5 * 60 * 1000

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
export type View = { text: string; tone: Tone; tooltip: string }

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const BAR_CELLS = 8

function bar(fraction: number): string {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.ceil(fraction * BAR_CELLS)))
  return '▰'.repeat(filled) + '▱'.repeat(BAR_CELLS - filled)
}

/** What the status bar shows `now`, given when the agent's last reply ended. */
export function view(lastEnd: number, now: number, ttlMs = CACHE_TTL_MS): View {
  const left = lastEnd + ttlMs - now
  if (left <= 0) {
    return {
      text: `cache cold ${mmss(-left)} ago`,
      tone: 'danger',
      tooltip: 'The prompt cache has expired; the next prompt pays full price.'
    }
  }
  const fraction = left / ttlMs
  return {
    text: `cache ${bar(fraction)} ${mmss(left)}`,
    tone: fraction <= 0.25 ? 'warning' : 'success',
    tooltip: `Time until the prompt cache goes cold (${ttlMs >= 3_600_000 ? '1-hour' : '5-minute'} cache, read from the transcript).`
  }
}
