// One adapter per agent kind. An adapter reads the agent's own local record of its API usage and
// answers how long the prompt cache it wrote lasts, or null when that cannot be known. The clock
// hides its countdown for null rather than guessing.
export type Adapter = {
  /** The `agent` value Orca reports for this kind, for example `claude`. */
  agent: string
  lifetimeMs(sessionId: string): Promise<number | null>
}

/** Returns the last `maxBytes` of a session's transcript as text, or null when there is none. */
export type TranscriptTail = (sessionId: string, maxBytes: number) => Promise<string | null>

export const FIVE_MINUTES_MS = 5 * 60 * 1000
export const ONE_HOUR_MS = 60 * 60 * 1000
const TAIL_BYTES = 512 * 1024

/**
 * Claude Code writes each API response's `usage` into its transcript. `cache_creation` splits
 * the tokens written to the cache by lifetime, so the newest entry that wrote any says which
 * lifetime applies (https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
 */
export function claudeLifetimeFromText(text: string): number | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.includes('cache_creation')) continue
    let usage: { cache_creation?: Record<string, number> } | undefined
    try {
      usage = JSON.parse(line)?.message?.usage
    } catch {
      continue // the first line of a tail read can be cut off
    }
    const written = usage?.cache_creation
    if (!written) continue
    if ((written.ephemeral_1h_input_tokens ?? 0) > 0) return ONE_HOUR_MS
    if ((written.ephemeral_5m_input_tokens ?? 0) > 0) return FIVE_MINUTES_MS
  }
  return null
}

export function claudeAdapter(tail: TranscriptTail): Adapter {
  return {
    agent: 'claude',
    async lifetimeMs(sessionId) {
      const text = await tail(sessionId, TAIL_BYTES)
      return text === null ? null : claudeLifetimeFromText(text)
    }
  }
}
