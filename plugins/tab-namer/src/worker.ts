// Names an agent's tab after its task the first time that agent finishes.
//
// The task text comes only from what Orca already knows: the prompt Orca submitted
// (`agent.prompt.before`), the dispatched task's title, or the session title in Agent Session
// History. Terminal output is never read, so text an agent printed cannot become a tab name or
// reach the optional model.
//
// Naming is rule-based by default. The optional model mode runs `claude -p` on Haiku with no
// tools, no MCP servers and no settings files (so no hooks and no permission-mode bypass),
// in the system temp folder; its answer is only ever used as a title.
import { execFile } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { composeName, taskFromPrompt } from './name'

const PROMPT_KEY = (terminalId: string) => `prompt:${terminalId}`
const NAMED_KEY = (key: string) => `named:${key}`
const MODEL_TIMEOUT_MS = 20_000
const RENAME_TIMEOUT_MS = 15_000
/** Longest slice of the task the model sees; a title needs no more. */
const MODEL_INPUT_CHARS = 300

type Settings = { enabled: boolean; maxChars: number; useModel: boolean }
/** `workspaceId` is the `workspace.list` id (`workspaceListId` on events). */
type Target = { terminalId: string; sessionId?: string; workspaceId?: string }

/**
 * The worker's environment, plus the Windows profile folders Orca's worker leaves out: without
 * APPDATA the Orca CLI cannot find the running app ("APPDATA is not set").
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (process.platform === 'win32') {
    env.APPDATA ??= join(homedir(), 'AppData', 'Roaming')
    env.LOCALAPPDATA ??= join(homedir(), 'AppData', 'Local')
  }
  return env
}

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout: timeoutMs, cwd: tmpdir(), env: childEnv(), windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolve(String(stdout))
    })
    // Close stdin: `claude -p` otherwise waits 3 s for piped input before it starts.
    child.stdin?.end()
  })
}

export default function activate(orca: OrcaWorkerApi): void {
  const inflight = new Set<string>()

  const readSettings = async (): Promise<Settings> => {
    const raw = ((await orca.settings.get()) ?? {}) as Record<string, unknown>
    const maxChars = Number(raw.maxChars)
    return {
      enabled: raw.enabled !== false,
      maxChars: Number.isFinite(maxChars) && maxChars >= 8 ? Math.min(maxChars, 60) : 24,
      useModel: raw.useModel === true,
    }
  }

  orca.hooks.on('agent.prompt.before', (event) => {
    // Keep only the one line a title is made from, not the whole prompt, and only once per tab.
    const task = taskFromPrompt(event.prompt ?? '')
    if (!event.terminalId || !task) return
    const store = async (): Promise<void> => {
      if (!(await readSettings()).enabled) return
      if (await orca.storage.get(NAMED_KEY(event.terminalId))) return
      if (await orca.storage.get(PROMPT_KEY(event.terminalId))) return
      await orca.storage.set(PROMPT_KEY(event.terminalId), task)
    }
    store().catch((err) => orca.log(`storing prompt failed: ${String(err)}`))
    // Pass: this hook only observes.
  })

  /** The task text for an agent, from the first source that has one. */
  const taskText = async (target: Target): Promise<string> => {
    const hooked = await orca.storage.get(PROMPT_KEY(target.terminalId))
    if (typeof hooked === 'string' && hooked) return hooked

    // `agents.list` without a workspace covers only the focused one; an agent finishing in the
    // background is looked up in its own.
    const { agents } = await orca.host.call('agents.list', target.workspaceId ? { workspaceId: target.workspaceId } : undefined)
    const agent = agents.find((a) => a.terminalId === target.terminalId)
    if (agent?.task?.title) return taskFromPrompt(agent.task.title)

    if (target.sessionId && orca.host.has('agent.listSessions')) {
      try {
        const { sessions } = await orca.host.call('agent.listSessions', { limit: 50 })
        const session = sessions.find((s) => s.sessionId === target.sessionId)
        if (session?.title) return taskFromPrompt(session.title)
      } catch (err) {
        orca.log(`agent.listSessions failed: ${String(err)}`)
      }
    }
    return ''
  }

  const askModel = async (task: string, maxChars: number): Promise<string | null> => {
    const instruction =
      `Give a tab title of at most ${maxChars} characters for this coding task. ` +
      `Reply with the title only, no quotes or punctuation.\n\nTask: ${task.slice(0, MODEL_INPUT_CHARS)}`
    const args = [
      '-p',
      '--model', 'haiku',
      '--tools', '',
      '--strict-mcp-config',
      '--setting-sources', '',
      '--permission-mode', 'default',
      '--no-session-persistence',
      instruction,
    ]
    try {
      return composeName(await run('claude', args, MODEL_TIMEOUT_MS), maxChars)
    } catch (err) {
      orca.log(`model naming failed, using the rule-based name: ${String(err)}`)
      return null
    }
  }

  const rename = async (target: Target, name: string): Promise<void> => {
    // `orca chat rename` is for Orca's own chat tabs ("No chat with session id" for a terminal
    // agent), so an agent's tab is renamed through its terminal.
    const cli = process.env.ORCA_CLI_COMMAND || 'orca'
    await run(cli, ['terminal', 'rename', '--terminal', target.terminalId, '--title', name], RENAME_TIMEOUT_MS)
  }

  const nameTab = async (target: Target, force: boolean): Promise<{ ok: boolean; name?: string; reason?: string }> => {
    // Keyed by terminal: the tab is the terminal's, and a status event may lack a session id.
    const key = target.terminalId
    if (inflight.has(key)) return { ok: false, reason: 'in_flight' }
    inflight.add(key)
    try {
      const settings = await readSettings()
      if (!settings.enabled && !force) return { ok: false, reason: 'disabled' }
      // Name a tab once, so a title the person set later is not overwritten on the next turn.
      if (!force && (await orca.storage.get(NAMED_KEY(key)))) return { ok: false, reason: 'already_named' }

      const task = await taskText(target)
      if (!task) return { ok: false, reason: 'no_task' }
      const name = (settings.useModel ? await askModel(task, settings.maxChars) : null) ?? composeName(task, settings.maxChars)
      if (!name) return { ok: false, reason: 'no_name' }

      await rename(target, name)
      await orca.storage.set(NAMED_KEY(key), name)
      await orca.storage.delete(PROMPT_KEY(target.terminalId))
      orca.log(`named ${key}: ${name}`)
      return { ok: true, name }
    } finally {
      inflight.delete(key)
    }
  }

  orca.events.on('agent.status.changed', (event) => {
    if (event.state !== 'done' || !event.terminalId) return
    nameTab({ terminalId: event.terminalId, sessionId: event.sessionId, workspaceId: event.workspaceListId }, false)
      .then((result) => {
        if (!result.ok && result.reason !== 'already_named') orca.log(`not named: ${result.reason}`)
      })
      .catch((err) => orca.log(`naming failed: ${String(err)}`))
  })

  orca.commands.register('tab-namer.renameThis', async () => {
    const { agents } = await orca.host.call('agents.list')
    // The agent whose state changed last is the one the person is most likely looking at.
    const agent = agents
      .filter((a) => a.terminalId)
      .sort((a, b) => b.stateStartedAt - a.stateStartedAt)[0]
    if (!agent?.terminalId) return 'No agent in this workspace.'
    const result = await nameTab({ terminalId: agent.terminalId, sessionId: agent.sessionId ?? undefined }, true)
    return result.ok ? `Renamed to "${result.name}".` : `Not renamed: ${result.reason}.`
  })

  orca.log('tab-namer started')
}
