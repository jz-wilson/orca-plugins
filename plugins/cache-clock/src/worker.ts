// Counts down to the prompt cache going cold after an agent's reply ends, and shows it in the
// status bar. The worker stays running while the plugin is enabled (it has a status bar item),
// so a plain interval can repaint the item every second.
//
// State comes from `agents.list`, which only holds live panes, so a closed pane cannot keep the
// clock hidden or alive. It is re-read on every status event and every REFRESH_MS as a safety net.
import type { Disposable, OrcaWorkerApi } from 'orca/worker'
import { claudeAdapter, type Adapter } from './adapters'
import { claudeTranscriptTail } from './claude-transcript'
import { view } from './clock'

const ITEM = 'cache-clock'
const HIDE_AFTER_COLD_MS = 2 * 60 * 60 * 1000
const REFRESH_MS = 30_000

// To support another agent, add an adapter for its `agent` kind here (see src/adapters.ts).
const ADAPTERS: Adapter[] = [claudeAdapter(claudeTranscriptTail)]

/** `ttlMs` is the cache lifetime of the newest finished agent, null when its adapter cannot tell. */
type Snapshot = { working: boolean; newestDone: number | null; ttlMs: number | null }

let timer: ReturnType<typeof setInterval> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined
let subscription: Disposable | undefined

export default function activate(orca: OrcaWorkerApi): void {
  clearTimers()
  let snap: Snapshot = { working: false, newestDone: null, ttlMs: null }
  let shown = ''

  const send = async (params: Parameters<typeof orca.host.call<'statusBar.update'>>[1]): Promise<void> => {
    const key = JSON.stringify(params)
    if (key === shown) return
    await orca.host.call('statusBar.update', params)
    shown = key
  }

  const paint = async (): Promise<void> => {
    // Hidden while working, with nothing finished, or when the lifetime is unknown: a countdown
    // from a guessed lifetime would be wrong.
    if (snap.working || snap.newestDone === null || snap.ttlMs === null) {
      await send({ id: ITEM, visible: false })
      return
    }
    // A reply that ended long ago is not worth a red "cold" badge.
    if (Date.now() - snap.newestDone > snap.ttlMs + HIDE_AFTER_COLD_MS) {
      await send({ id: ITEM, visible: false })
      return
    }
    const v = view(snap.newestDone, Date.now(), snap.ttlMs)
    await send({ id: ITEM, visible: true, text: v.text, tone: v.tone, tooltip: v.tooltip })
  }

  // Refreshes can overlap (an event, the 30 s timer, start-up); only the newest one may write `snap`.
  let generation = 0
  const refresh = async (): Promise<void> => {
    const mine = ++generation
    const { agents } = await orca.host.call('agents.list')
    // `agents.list` covers the focused workspace and gives no per-chat focus signal. Follow the
    // agent whose state changed last: hidden while it works, counting down once it is done.
    let newest: (typeof agents)[number] | null = null
    let latest: { state: string; at: number } | null = null
    for (const a of agents) {
      if (a.state === 'done' && (newest === null || a.stateStartedAt > newest.stateStartedAt)) {
        newest = a
      }
      if (latest === null || a.stateStartedAt > latest.at) {
        latest = { state: a.state, at: a.stateStartedAt }
      }
    }
    let ttlMs: number | null = null
    const adapter = ADAPTERS.find((x) => x.agent === newest?.agent)
    if (adapter && newest?.sessionId) {
      try {
        ttlMs = await adapter.lifetimeMs(newest.sessionId)
      } catch (err) {
        orca.log(`${adapter.agent} adapter failed: ${String(err)}`)
      }
    }
    if (mine !== generation) return
    snap = { working: latest?.state === 'working', newestDone: newest?.stateStartedAt ?? null, ttlMs }
    await paint()
  }

  const safe = (what: string, run: () => Promise<void>): void => {
    run().catch((err) => orca.log(`${what} failed: ${String(err)}`))
  }

  subscription = orca.events.on('agent.status.changed', async () => {
    try {
      await refresh()
    } catch (err) {
      orca.log(`refresh failed: ${String(err)}`)
    }
  })

  safe('refresh', refresh)
  refreshTimer = setInterval(() => safe('refresh', refresh), REFRESH_MS)
  timer = setInterval(() => safe('paint', paint), 1000)
  orca.log('cache-clock started')
}

function clearTimers(): void {
  if (timer) clearInterval(timer)
  if (refreshTimer) clearInterval(refreshTimer)
  subscription?.dispose()
  timer = undefined
  refreshTimer = undefined
  subscription = undefined
}

export function deactivate(): void {
  clearTimers()
}
