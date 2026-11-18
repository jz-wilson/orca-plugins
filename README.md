# orca-plugins

Plugins for [Orca](https://github.com/stablyai/orca), MIT licensed.

| Plugin | What it does | Runs code |
| :- | :- | :- |
| [helpin-tasks](plugins/helpin-tasks) | Sidebar panel of open Helpin tasks; Start opens a workspace on a new branch with an agent on the task | Yes, a trusted worker that calls only the Helpin URL you set; [what it can touch](plugins/helpin-tasks/README.md#security-and-privacy) |
| [tab-namer](plugins/tab-namer) | Names an agent's tab after its task when the agent first finishes | Yes, a trusted worker that never reads terminal output; [what it can touch](plugins/tab-namer/README.md#security-and-privacy) |
| [cache-clock](plugins/cache-clock) | Status bar countdown until an agent's prompt cache goes cold | Yes, a trusted worker; [what it can touch](plugins/cache-clock/README.md#security-and-privacy) |

## Install

This repository is also an Orca plugin catalog (`orca-catalog.json`). Add it once, then install by id:

```sh
orca plugin catalog add jz-wilson/orca-plugins          # prints a fingerprint; re-run with --approve <fingerprint>
orca plugin install jz-wilson.cache-clock               # prints what the plugin may do; re-run with --approve <fingerprint>
```

Orca shows exactly what each plugin is granted before anything runs, and the approval is bound to that version's files. Read a plugin's source before approving it.

## Safety

- No plugin here uses the network unless its README says so.
- No credentials, tokens or personal data live in this repository. Do not commit any: use a secret manager.
- Report a security problem through GitHub's private vulnerability reporting on this repository.

## Contributing

One folder per plugin under `plugins/`, each with its own `orca-plugin.json` and README that states what the plugin reads, writes and contacts. Run `orca plugin validate` and `orca plugin test` before opening a pull request.

## License

[MIT](LICENSE)
