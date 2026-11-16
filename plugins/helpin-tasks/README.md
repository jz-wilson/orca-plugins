# Helpin Tasks

A right-sidebar panel that lists your open Helpin tasks. Pick one, press **Start**, and Orca creates a workspace on a new branch (named for the task key, such as `abc-113`) and starts an agent working on it. It works like Orca's built-in Linear task list, as a panel, because plugins cannot add to the native Tasks view yet.

Requires a Helpin server whose MCP endpoint accepts a bearer API token. Nothing is configured by default.

## Set up

1. Install and approve the plugin.
2. Open the **Helpin Tasks** panel, enter your Helpin MCP URL (for example `https://helpin.example.com/mcp`) and an API token, and press **Save**.
3. Optional, in Orca's plugin settings: **Task key prefix** (only list keys that start with it, such as `ABC-`) and **Agent to start** (default `claude`).

## Security and privacy

This plugin runs as a `trusted-worker`: its own Node.js process with your user account's access, so Orca asks you to approve it. What it does with that access:

- **Network:** it sends HTTPS requests to the one URL you configure, and nowhere else. The URL must be `https`, or `http` on `localhost`, and must not contain a username or password. Requests are the MCP `initialize`, `notifications/initialized`, `list_tasks`, and ending the session. Redirects are refused, responses are capped at 2 MB, and each request times out after 15 seconds.
- **Your token:** stored in Orca's per-plugin encrypted secret store with the server it was entered for, sent only in the `Authorization` header to that server, and never logged, shown or returned to the panel. If the URL setting is changed to another server, the saved token is not sent there; you must enter it again. The panel can set the token but not read it back, and an error from the network is replaced by a fixed message so it cannot quote the token.
- **What it reads:** Helpin task keys, ids, titles, states and priorities; Orca's list of Git projects (names and ids).
- **What it changes:** only when you press **Start**: it asks Orca to create a workspace (a new Git branch and worktree) in the project you chose, and to start the agent there with a prompt naming the task. A project's own setup script runs as it normally does for a new workspace.
- **Reads or writes no files** and runs no shell commands of its own. It has no runtime dependencies.
- **Task text is data:** a task title is flattened to one line, stripped of invisible characters, length-limited and quoted as a string, and the prompt tells the agent to treat it as data. The task key must look like `ABC-123` and the id must be a short token of letters, digits, `_` and `-` before they become a branch name or part of a prompt. Start works only on a project Orca listed for the panel. The agent is told to read the full task from Helpin itself.

Capabilities requested: `settings:own`, `secrets:own`, `workspace:read`, `workspace:create`, `agent:launch`. Read `src/` before approving; it is under 800 lines including tests.

## Limits

- Lists open tasks only, newest first within a priority, at most 2,000.
- **Start** needs the agent to have Helpin's tools available (the prompt asks it to read the task with `get_task_context`); otherwise it works from the task id and title in the prompt.
- Orca's native Tasks view and sidebar cards cannot be extended by plugins (their contribution points are reserved), so this is a separate panel.

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
