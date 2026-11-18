// Pure naming rules with no Orca API, so src/name.test.ts can exercise them directly.

/** Openers that say how a request is asked, not what it asks for. */
const FILLER =
  /^(?:(?:hey|hi|ok(?:ay)?|so|now|please|pls|can you|could you|would you|will you|i want you to|i'd like you to|i would like you to|i need you to|i want to|i need to|let's|lets|help me(?: to)?|go ahead and|try to)[\s,:]+)+/i
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g
/**
 * Characters that have no place in a tab title: controls (Cc), format characters such as bidi
 * overrides and zero-width spaces (Cf), line and paragraph separators (Zl, Zp), and quotes.
 */
const STRIP = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"'`“”‘’]/gu

/** The opening request of a prompt, one line, with how-it-was-asked filler removed. */
export function taskFromPrompt(prompt: string): string {
  const lines = prompt.replace(ANSI, '').replace(/\r/g, '').split('\n')
  let inFence = false
  for (const raw of lines) {
    const line = raw.trim()
    // Slash commands and pasted code are not the task.
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence || line.length < 4 || line.startsWith('/')) continue
    return tidy(line.replace(FILLER, ''))
  }
  return ''
}

function tidy(line: string): string {
  return line
    .replace(STRIP, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?;:,]+$/u, '')
    .trim()
}

/**
 * A tab title from free text (the task, or a model's answer): its first non-empty line,
 * without list markers, labels or quotes, capitalized, and cut on a word boundary to `maxChars`.
 */
export function composeName(raw: string, maxChars: number): string | null {
  const first = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!first) return null
  // A list marker is a bullet or a number followed by `.` or `)` and a space; `2FA` and `404` stay.
  let line = first
    .replace(/^(?:[-*•]+\s+|\d+[.)]\s+)/u, '')
    .replace(/^(?:name|title|tab)\s*[:：]\s*/i, '')
  // A leading dash would be read as a flag by the Orca CLI.
  line = tidy(line).replace(/^[-\s]+/, '')
  if (!line) return null
  line = line[0].toUpperCase() + line.slice(1)
  const chars = Array.from(line)
  if (chars.length <= maxChars) return line
  const cut = chars.slice(0, maxChars).join('')
  // The cut already ends on a word when the next character is a space.
  const space = chars[maxChars] === ' ' ? cut.length : cut.lastIndexOf(' ')
  // Cut on the last word boundary unless that throws most of the title away.
  const name = (space >= maxChars / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:-]+$/u, '')
  return name || null
}
