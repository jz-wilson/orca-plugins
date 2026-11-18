# Tab Namer

Names an agent's terminal tab after its task the first time that agent finishes, so a row of `claude` tabs becomes `Fix flaky auth test`, `Add upload retries`, and so on.

- Names each tab once. A title you set by hand afterwards is never overwritten.
- **Tab Namer: Name this agent's tab now** (command palette) renames the most recently active agent's tab immediately, even if it was named before.
- Rule-based by default: the first line of the task, with filler like "can you please" removed, cut on a word boundary to 24 characters (setting `maxChars`).

## Where the task comes from

In order, the first that has text:

1. The prompt Orca submitted to the agent (launch prompts, orchestration dispatches, `orca terminal send`), from the `agent.prompt.before` hook.
2. The dispatched task's title from `agents.list`.
3. The session's title in Orca's Agent Session History, which is usually the start of its first message. This covers prompts you type yourself.

Terminal output is never read, so nothing an agent prints (a web page, a file, a log) can become a tab name.

## Optional: name with Claude Haiku

Setting `useModel` (off by default) asks Haiku for the title instead. It runs:

```sh
claude -p --model haiku --tools "" --strict-mcp-config --setting-sources "" --permission-mode default --no-session-persistence "<instruction + task>"
```

in the system temp folder, so the call has no tools, no MCP servers, and no settings files. That means none of your hooks run and your permission-mode bypass does not apply. It sends at most 300 characters of the task, and the answer is only ever used as a title. If it fails or times out (20 s), the rule-based name is used.

## Security and privacy

This plugin runs as a `trusted-worker`: its own Node.js process with your user account's access, so Orca asks you to approve it before it runs. What it does with that access:

- **Asks Orca for** `agent:read` (agent list and status events), `history:read` (session titles only, never the conversation), `storage:own` (the last hooked prompt per terminal, deleted once the tab is named, plus which tabs were named) and `settings:own`.
- **Runs** `orca terminal rename` to set the title (no host API exists for it). With `useModel` on, it also runs `claude -p` as above. Both go through `execFile` with no shell, so no text is interpreted as a command.
- **Reads and writes** no files.
- **Uses no network** itself, and has no runtime dependencies. With `useModel` on, `claude` contacts Anthropic with the task text.

Read `src/` before approving. It is about 250 lines including tests.

## Limits

- The Windows worker environment lacks `APPDATA`, which the Orca CLI needs, so the worker fills it in from your profile folder.
- `orca chat rename` only covers Orca's own chat tabs, so agents are always renamed through their terminal.
- A tab without a hooked prompt, task title or session history entry (for example an agent on an SSH host) is not named.

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
