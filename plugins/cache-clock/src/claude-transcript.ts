// Finds Claude Code's transcript for a session id and reads its tail. Claude Code keeps it at
// ~/.claude/projects/<project folder>/<sessionId>.jsonl.
import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TranscriptTail } from './adapters'

const SESSION_ID = /^[0-9a-f-]{8,64}$/i

export const claudeTranscriptTail: TranscriptTail = async (sessionId, maxBytes) => {
  if (!SESSION_ID.test(sessionId)) return null // the id becomes part of a path
  const root = join(homedir(), '.claude', 'projects')
  let folders: string[]
  try {
    folders = await readdir(root)
  } catch {
    return null
  }
  for (const folder of folders) {
    let handle
    try {
      handle = await open(join(root, folder, `${sessionId}.jsonl`), 'r')
    } catch {
      continue // not in this project folder
    }
    try {
      const { size } = await handle.stat()
      const length = Math.min(size, maxBytes)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, size - length)
      return buffer.toString('utf8')
    } finally {
      await handle.close()
    }
  }
  return null
}
