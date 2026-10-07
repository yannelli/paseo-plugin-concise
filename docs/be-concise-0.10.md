# be-concise 0.10 to 0.12 support

Created: 2026-10-05. Last updated: 2026-10-07.

This page lists the be-concise settings and tools that this plugin exposes, the oldest version that has each one, and the rules the controls follow. Sources, read on 2026-10-05: the [v0.10.0 release](https://github.com/yannelli/be-concise/releases/tag/v0.10.0), [configuration.md](https://github.com/yannelli/be-concise/blob/v0.10.0/plugins/concise/docs/configuration.md), and [tools.md](https://github.com/yannelli/be-concise/blob/v0.10.0/plugins/concise/docs/tools.md). Read them again before you change a control.

## Controls and versions

| Setting or tool | Available since | Plugin location |
| --- | --- | --- |
| `context.enabled`, `context.perTurn` | 0.8.0 | Configuration → Checks → Session rules |
| `subagentStop.enabled`, `subagentStop.exemptAgentTypes` | 0.8.0 | Configuration → Checks → Replies |
| `testFilter.codexPostToolUse` | 0.8.0 | Configuration → Checks → Test output |
| `features.dictionary.enabled`, `mode`, `entries` | 0.10.0 | Configuration → Dictionary |
| `tools/tune.mjs` (`tune`) | 0.10.0 | Configuration → Tune, through the `concise.tune` RPC |
| `dictionary` as a `BEC_FEATURE_*` id | 0.10.0 | Configuration → Effective configuration → Daemon environment |
| `ignoreGlobs`, `styleIgnoreGlobs`, `allowList`, `bypass` | 0.7.0 | Configuration → Exceptions |
| `features.aiWriting.allow`, `enablePatterns`, `disablePatterns` | 0.7.0 | Configuration → Style |
| `log.*`, `monitor.persist` | 0.7.0 | Configuration → Logging |

0.7.0 is the oldest version this plugin supports, so a 0.7.0 row means that version or earlier. A control appears only when the `defaults` object from the installed be-concise has its key. The upstream `validateConfig` rejects unknown keys, so a control for a newer key would make every save fail on an older install. The Tune section needs 0.10.0. The JSON view edits every other key, such as `features.aiWriting.categories`, `packs`, and `options`.

## List controls

Each list control follows the be-concise merge rule for its key.

| Rule | Keys | Control behavior |
| --- | --- | --- |
| Replace | `ignoreGlobs`, `subagentStop.exemptAgentTypes` | In the highest active file, shows the effective list; in other files, the built-in list. The first change copies that list into the file. **Use inherited** removes the key. |
| Union | `styleIgnoreGlobs`, `allowList.*`, `bypass.*`, `features.aiWriting.allow` | Inherited items are read-only. Items in the file add to them. |
| Layer | `features.aiWriting.enablePatterns`, `disablePatterns` | Shows the items in the file only. A higher layer cancels a lower one. |

## Dictionary

Entries merge across layers by `id`. **Turn off here** adds `{ "id": "<id>", "enabled": false }` to the file. **Copy here** opens the editor with the inherited entry, and the copy replaces it in place. The editor checks the required fields and the id pattern `^[a-z0-9][a-z0-9-]*$`. For a `regex` entry, `flags` replaces `caseSensitive`, so the editor hides the case switch while Flags has a value. be-concise compiles the pattern when you save. A failed save names the entry as `features.dictionary.entries[<index>]: <reason>`, and the editor shows the reason on that entry.

## Writing tuner

The tuner accepts pasted samples only: up to 20, each up to 64 KiB. It does not read host paths. It runs `tune` in a child Node.js process, because it loads the project's JavaScript pattern packs from `.claude/concise/patterns` and `.codex/concise/patterns`. **Apply to draft** merges the proposed delta into the selected file's draft with the upstream `mergeDelta` rules: objects merge, lists gain new items, and other values are replaced. **Save changes** then writes the file with the revision check.

## Activity decisions

| Record | Decision in be-concise | Decision in this plugin |
| --- | --- | --- |
| `session-context` with rules in `additionalContext` only | `flag` | `context`, shown as **Rules sent** |
| `session-context` with a `systemMessage` (configuration warnings) | `flag` | `flag` |
| `post-test-filter` | `filter` | `filter`, shown as **Filtered** |

The composer pill counts `deny`, `block`, `ask`, and `flag`, so injected rules do not raise it.

## 0.11 and 0.12

Sources, read on 2026-10-07: the [v0.10.1](https://github.com/yannelli/be-concise/releases/tag/v0.10.1), [v0.11.0](https://github.com/yannelli/be-concise/releases/tag/v0.11.0), and [v0.12.0](https://github.com/yannelli/be-concise/releases/tag/v0.12.0) releases, the diff from v0.10.0 to v0.12.0, and [host-features.md](https://github.com/yannelli/be-concise/blob/v0.12.0/plugins/concise/docs/host-features.md#omp) at v0.12.0. Neither release adds a configuration key, so the configuration controls do not change.

| Change | Since | Plugin behavior |
| --- | --- | --- |
| The project registry stores `repo` (name, root, worktree, subdirectory, or `null`), and the hub reports `missing` when a project folder no longer exists | 0.11.0 | The project picker hides missing projects behind **Show N missing**, groups projects by repository, and names a worktree `<name> (worktree)`, as `concise-web` does. A selected missing project stays listed. Older hubs send neither field, so their projects show as present in one list. |
| The omp extension `omp/extension.mjs`, listed under `omp.extensions` in `plugins/concise/package.json` | 0.12.0 | The Plugin tab installs it for omp, and discovery reads the omp caches. See [be-concise installer](plugin-installer.md). |
| omp hook records | 0.12.0 | Records reach the same registry with the tool names `Write`, `Edit`, `Bash`, and `apply_patch`, and omp session IDs. An omp `apply_patch` record carries the patch in `tool_input.input`, where Codex uses `tool_input.command`. The activity target reads both. |
| Reply checks read `last_assistant_message` and `SubagentHandback` messages | 0.12.0 | No change. Previews still pass the reply text. |

omp has no subagent stop event, so it does not check subagent replies. It reads the same `.claude/concise.json` and `.codex/concise.json` project files. The workspace enforcement toggle writes `.claude/concise.json` for omp agents, and the composer pill appears for the Paseo `omp` provider.

## Not in this plugin

- The settings CLI, the MCP server, and the `concise-config` and `concise-tune` skills. Agents use them inside Claude Code, Codex, and omp.
- Pattern pack management from the be-concise web console.
