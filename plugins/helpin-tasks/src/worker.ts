// Talks to the Helpin server for the panel. The token lives in orca.secrets and is read only here;
// the panel can set it but never read it back, and it is bound to the server it was entered for.
import type { OrcaWorkerApi } from 'orca/worker'
import { isTaskId, isTaskKey, isToken, parseServerUrl, startPrompt, workspaceName, type Task } from './helpin'
import { helpinMessage, listOpenTasks, type Fetch } from './mcp'

const TOKEN = 'token'
const TOKEN_ORIGIN = 'tokenOrigin'

const hostMessage = (error: unknown): string => (error instanceof Error ? error.message : 'Something went wrong')
// Literal types, so each handler's answer matches the contract in src/protocol.ts.
const fail = (error: string) => ({ ok: false as const, error })

export default function activate(orca: OrcaWorkerApi, doFetch: Fetch = fetch): void {
  const setting = async (key: string): Promise<string> => {
    const value = await orca.settings.get(key)
    return typeof value === 'string' ? value : ''
  }

  /** The token, only when it was entered for the server URL that is configured now. */
  const tokenFor = async (url: string): Promise<string | null> => {
    const token = await orca.secrets.get(TOKEN)
    const origin = await orca.secrets.get(TOKEN_ORIGIN)
    return token !== null && origin === new URL(url).origin ? token : null
  }

  // Projects the panel was offered; a start for any other id is refused.
  let offered = new Set<string>()

  orca.panels.handle('config.get', async () => {
    const url = parseServerUrl(await setting('serverUrl'))
    return {
      serverUrl: await setting('serverUrl'),
      hasToken: url !== null && (await tokenFor(url)) !== null,
      keyPrefix: await setting('keyPrefix')
    }
  })

  orca.panels.handle('config.save', async ({ serverUrl, token }) => {
    const url = parseServerUrl(serverUrl)
    if (!url) return fail('Enter an https URL (http only for localhost), without a username or password.')
    const given = token.trim()
    if (given && !isToken(given)) return fail('The token must be one line of printable characters, with no spaces.')
    // A saved token is never sent to a different server than the one it was entered for.
    if (!given && (await tokenFor(url)) === null) return fail('Enter the token for this URL.')
    await orca.settings.set('serverUrl', url)
    if (given) {
      await orca.secrets.set(TOKEN, given)
      await orca.secrets.set(TOKEN_ORIGIN, new URL(url).origin)
    }
    return { ok: true as const }
  })

  orca.panels.handle('projects.list', async () => {
    try {
      const { projects } = await orca.host.call('project.list')
      const git = projects.filter((p) => p.kind === 'git')
      offered = new Set(git.map((p) => p.id))
      return { ok: true as const, projects: git.map((p) => ({ id: p.id, name: p.name })) }
    } catch (error) {
      return fail(hostMessage(error))
    }
  })

  orca.panels.handle('tasks.list', async () => {
    const url = parseServerUrl(await setting('serverUrl'))
    const token = url ? await tokenFor(url) : null
    if (!url || !token) return fail('Set the server URL and token first.')
    try {
      const tasks = await listOpenTasks(url, token, await setting('keyPrefix'), doFetch)
      return { ok: true as const, tasks, fetchedAt: Date.now() }
    } catch (error) {
      // Only our own messages are shown or logged: a fetch error can quote the request, token included.
      orca.log(`list failed: ${helpinMessage(error)}`)
      return fail(helpinMessage(error))
    }
  })

  orca.panels.handle('task.start', async ({ task, projectId }) => {
    // The panel is a separate frame; check what it sends before it becomes a prompt and a branch name.
    if (!isTaskKey(task?.key) || !isTaskId(task.id) || typeof task.name !== 'string' || !offered.has(projectId)) {
      return fail('That task or project is not valid. Refresh the panel and try again.')
    }
    const safe: Task = { key: task.key, id: task.id, name: task.name, state: '', priority: '' }
    try {
      const { workspaceId } = await orca.host.call('workspace.create', {
        projectId,
        name: workspaceName(safe),
        agent: (await setting('agent')) || 'claude',
        prompt: startPrompt(safe),
        open: true
      })
      return { ok: true as const, workspaceId }
    } catch (error) {
      orca.log(`start failed: ${hostMessage(error)}`)
      return fail(hostMessage(error))
    }
  })
}
