# be-concise installer

Created: 2026-10-05. Last updated: 2026-10-09.

The **Plugin** tab installs, updates, downgrades, and removes the `concise@be-concise` plugin for Claude Code, Codex, and omp (oh-my-pi) on the daemon host. It uses the [yannelli/be-concise GitHub releases](https://github.com/yannelli/be-concise/releases). The same view appears in the **Connect be-concise** state when no installation is found.

## Releases

- The server reads `GET https://api.github.com/repos/yannelli/be-concise/releases?per_page=30` without a token and caches the list for 10 minutes. **Check for updates** reads it again.
- The list keeps published releases with a `vX.Y.Z` tag at or above 0.7.0. Drafts and prereleases are excluded. omp needs 0.12.0 or newer, because that release added the omp extension. The tab hides the omp button for an older release, and the server refuses it.
- An install accepts only a version from that list. The server clones that tag with `git clone --depth 1 --branch vX.Y.Z` into a staging folder. Then it checks that both marketplace manifests are named `be-concise`, that the plugin version equals the tag, and that the adapter's `web` modules exist. It renames the folder to `releases/vX.Y.Z` last.
- Releases are stored under `${XDG_DATA_HOME:-~/.local/share}/paseo-be-concise/releases`. `state.json` records the active tag and the tag before it for each host, and the time each other release folder went out of use. Each status check deletes a release folder that no host has used for 7 days. A Claude Code session that started in that period keeps a valid root.

## Host commands

Each host gets its own release folder as a local marketplace. Each change points the marketplace at the new folder. The commands run with the daemon environment, so `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OMP_PROFILE`, and `XDG_DATA_HOME` apply. The CLIs are found on `PATH`, in `~/.local/bin`, or in `~/.bun/bin`. Each host command runs with the folder of its CLI first on `PATH`, because a bun global install of omp starts with `#!/usr/bin/env bun` and bun sits in the same folder. On Windows the server looks for `claude.exe`, `codex.exe`, `omp.exe`, and `git.exe`. Status output that is not the expected JSON shows as a host error. The server adds `--json` to every host command. Commands that print text with it still report failure through the exit code.

| Step | Claude Code (user scope) | Codex | omp (user scope) |
| --- | --- | --- | --- |
| Status | `claude plugin list --json`, `claude plugin marketplace list --json` | `codex plugin list --json`, `codex plugin marketplace list --json` | `omp plugin list --json`, then `<root>/marketplaces.json` |
| Point at a release | `claude plugin marketplace add <dir>`, then `claude plugin marketplace update be-concise` | `codex plugin marketplace remove be-concise` if the source differs, then `codex plugin marketplace add <dir>` | `omp plugin marketplace remove be-concise` if the source differs, then `omp plugin marketplace add <dir>` |
| Install or change version | `claude plugin install` or `claude plugin update concise@be-concise --scope user` | `codex plugin add concise@be-concise` | `omp plugin install concise@be-concise`, with `--force` when a version is installed |
| Remove | `claude plugin uninstall concise@be-concise --scope user` | `codex plugin remove concise@be-concise` | `omp plugin uninstall concise@be-concise` |

Remove deletes the `be-concise` marketplace only when it points at a managed release folder.

Behavior checked on 2026-10-05 with Claude Code 2.1.289 and Codex CLI 0.159.0, using temporary `CLAUDE_CONFIG_DIR` and `CODEX_HOME` folders:

- Claude Code loads a directory marketplace plugin in place from `<dir>/plugins/concise`. A changed folder takes effect at the next session start.
- `claude plugin marketplace add` with a new path points the existing `be-concise` marketplace at that path. Installed plugins then update from it. `claude plugin update` also downgrades when the folder version is lower.
- `codex plugin marketplace list --json` reports a local source with symlinks resolved. Claude Code reports the path as given. The server resolves both paths before it compares them.
- `codex plugin marketplace add` refuses a second source with the same name. `codex plugin marketplace remove` keeps the plugin installed and enabled. `codex plugin add` installs the folder version, including a lower one.
- Codex keeps a `trusted_hash` for each hook in `config.toml`. After a change, start a new session and review the hooks with `/hooks`.

Behavior checked on 2026-10-07 with omp 18.7.0 (a binary in `~/.local/bin`) and again on 2026-10-09 with omp 18.8.4 (a bun global install in `~/.bun/bin`). Both runs used the temporary profile `paseo-test` (`OMP_PROFILE=paseo-test`) and temporary `HOME` folders, and deleted the profile afterward. The results were the same on both versions:

- The data root `<root>` is `~/.omp/profiles/<name>` when `OMP_PROFILE` is set, even when `XDG_DATA_HOME` is also set. Otherwise it is `$XDG_DATA_HOME/omp` when that folder exists, and `~/.omp` in all other cases. `~/.local/share/omp` is not used when `XDG_DATA_HOME` is unset.
- `omp plugin marketplace list --json` prints text, so the server reads `<root>/marketplaces.json`. Each entry has `name`, `sourceType`, and `sourceUri`. A local `sourceUri` keeps the path as given, with symlinks unresolved. A GitHub source is stored as `yannelli/be-concise`.
- `omp plugin list --json` prints `{ "npm": [], "marketplace": [ { "id", "scope", "entries": [ { "scope", "installPath", "version", ... } ] } ] }`. An entry gets `"enabled": false` only after `omp plugin disable`. The key is absent until the plugin is disabled or enabled.
- A failed command prints a line that starts with `✘` and exits with code 1. That includes a duplicate marketplace or install and an uninstall of a plugin that is not installed.
- `omp plugin marketplace add` refuses a second marketplace with the same name. `omp plugin marketplace remove` keeps the plugin installed and enabled.
- `omp plugin install` refuses a plugin that is already installed. With `--force` it installs the folder version, whether that version is higher, lower, or the same. `omp plugin upgrade` also moves to a lower version. The server uses `install --force` because the same command also reinstalls the same version.
- omp copies the plugin to `<root>/plugins/cache/plugins/be-concise___concise___<version>` and links `<root>/plugins/node_modules/concise` to it. A version change replaces that folder. `omp plugin uninstall` deletes the folder, the link, and the entries in `installed_plugins.json` and `omp-plugins.lock.json`.

These points were not checked in a live omp session. They come from the be-concise [host-features.md](https://github.com/yannelli/be-concise/blob/v0.12.0/plugins/concise/docs/host-features.md#omp) at v0.12.0 and its maintainer notes. omp has no hook trust step. It loads the hooks as an extension at session start, so start a new omp session after a change. `/reload-plugins` does not load hooks.

## Existing installations

When the `be-concise` marketplace already uses another source, such as the GitHub repository or a source checkout, the tab shows that source. In that state the tab offers **Switch to GitHub releases** in place of **Install** and asks for confirmation. The result message lists the source it replaced so you can add it back. If a host command fails after the switch starts, the server adds the earlier source again and the error message names it. Remove on such a host uninstalls the plugin and keeps the marketplace.

## Jobs

Paseo plugin RPCs time out after 60 seconds on the client. A change can take longer, so `concise.installer.apply` starts a background job and returns at once. The tab polls `concise.installer.status` every 1.5 seconds while the job runs. During a job, status returns the last host report and does not start CLI calls. Only one change runs at a time. A plugin reload stops the running job and its host command.

## Adapter discovery

`PASEO_CONCISE_ROOT` takes priority. Next comes the managed release that was changed most recently in `state.json`, and after that the highest version in the Claude, Codex, and omp caches. The omp caches are `plugins/cache/plugins/be-concise___concise___<version>` under `~/.omp`, each `~/.omp/profiles/<name>`, and `$XDG_DATA_HOME/omp`. After a successful change, the backend closes its runtime and loads the selected release on the next refresh. The status check also updates `state.json` when a host's marketplace no longer points at a managed release.
