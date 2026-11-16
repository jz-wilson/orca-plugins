# Cache Clock

A status bar item that counts down until an agent's prompt cache goes cold, so you know whether your next message hits a warm cache.

- `cache ▰▰▰▰▰▰▰▰ 59:12`: time left, green, turning yellow in the last quarter.
- `cache cold 4:10 ago`: the cache expired and the next prompt writes it again.
- Hidden while the most recently active agent is working, when nothing has finished, or when the cache lifetime is unknown.

## How it knows the lifetime

It does not assume one. For each agent kind there is an adapter that reads the agent's own local transcript and answers how long the cache it wrote lasts, or `null` when it cannot tell (the item then hides).

| Agent | Source | Status |
| :- | :- | :- |
| `claude` | `usage.cache_creation` (`ephemeral_5m` / `ephemeral_1h` tokens) in `~/.claude/projects/<project>/<session>.jsonl` | Supported |
| others | None yet | Hidden |

To add one, write an `Adapter` (`agent` plus `lifetimeMs(sessionId)`) in `src/adapters.ts` and register it in `ADAPTERS` in `src/worker.ts`.

## Security and privacy

This plugin runs as a `trusted-worker`: its own Node.js process with your user account's access, so Orca asks you to approve it before it runs. What it does with that access:

- **Reads** one file per check: the newest 512 KB of the current Claude Code session's transcript, to find the cache-write usage fields. The session id is validated against a strict pattern before it becomes part of a path. It also lists the folder names under `~/.claude/projects` to find that file. Nothing else on disk is read.
- **Writes** nothing and runs no shell commands.
- **Uses no network** and has no runtime dependencies.
- **Asks Orca for** the `agent:read` capability only: the list of agents and their state, plus `agent.status.changed` events.

Transcript contents never leave the process: it extracts one number (the cache lifetime) and discards the rest. Read `src/` before approving; it is about 300 lines including tests.

## Limits

- The lifetime counts from the start of the last request. Orca reports when an agent finished, not when its last request started, so the countdown can run slightly long.
- No provider returns an expiry time, so the countdown is the lifetime plus the time the agent finished.
- It follows whichever agent changed state most recently, not the tab you are focused on.
- Each use of a cache refreshes it, so the clock restarts after every reply.

## Develop

```sh
bun install                 # type definitions only
orca plugin types .         # writes .orca/types (Git-ignored), which tsconfig.json uses
bunx tsc -p . --noEmit      # type-check
orca plugin validate .
orca plugin test .
orca plugin dev watch .     # load into Orca and stream logs; approve when prompted
```

## License

MIT, see the repository root.
