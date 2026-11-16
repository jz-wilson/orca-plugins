// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { Task } from './helpin'

export type { Task }
export type Project = { id: string; name: string }
/** Errors come back as data so the panel can show the message; the token never appears in one. */
export type Failure = { ok: false; error: string }

declare module 'orca' {
  interface PluginRequests {
    /** What is configured. The token itself never leaves the worker. */
    'config.get': { output: { serverUrl: string; hasToken: boolean; keyPrefix: string } }
    /** Saves the server URL and, when given, the token. */
    'config.save': { input: { serverUrl: string; token: string }; output: { ok: true } | Failure }
    'projects.list': { output: { ok: true; projects: Project[] } | Failure }
    'tasks.list': { output: { ok: true; tasks: Task[]; fetchedAt: number } | Failure }
    /** New workspace (branch and worktree) in `projectId`, with the agent started on the task. */
    'task.start': { input: { task: Task; projectId: string }; output: { ok: true; workspaceId: string } | Failure }
  }
}
