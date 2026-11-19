Be concise adds a page, a sidebar row, a workspace panel, and a composer pill for [be-concise](https://github.com/yannelli/be-concise). be-concise is a Claude Code, Codex, and omp plugin. Its hooks reject or flag wordy agent writing: long comments, oversized new files, padded PR bodies, and optional em dash and AI writing rules.

## What it does

- Lists hook decisions with their requests and responses. You can search them by tool, file, session, project, and reason. Call counts and a 30-minute chart sit above the list.
- Adds a composer pill to each Claude Code, Codex, and omp agent. The pill shows the number of rejected and flagged decisions in the workspace. The sidebar row shows the same number for all projects. The pill popup sets `softFail` in the project configuration file to turn enforcement off or on for the workspace.
- Edits the be-concise user, project, and `BEC_CONFIG_PATH` configuration files and the dictionary of flagged terms. A writing tuner proposes settings that pasted samples of your writing pass.
- Previews what each hook decides for a file write, patch, shell command, or final reply. A preview does not run the command or write the file.

## Setup

The daemon host needs be-concise 0.7.0 or newer for Claude Code or Codex, or 0.12.0 or newer for omp. The dictionary and the tuner need be-concise 0.10.0. Paseo 0.13.0 or newer is required.

Hooks save their decisions only when `monitor.persist` is on. be-concise 0.16.4 and newer turn it off by default. Turn it on under Configuration, Logging.

If be-concise is missing, the Plugin tab installs, updates, downgrades, or removes it. The host needs Git and the `claude`, `codex`, or `omp` CLI. Nothing changes until you press a button. The Plugin tab asks for confirmation before it replaces an existing be-concise marketplace source.

## Data and access

The plugin reads the be-concise project registry and saved hook records from the daemon user's home directory. It keeps up to 500 events per project in memory. Records can hold any text that the agent wrote or read. A save writes only the configuration file you select.

The Plugin tab reads release data from `api.github.com` and clones the chosen release from `github.com/yannelli/be-concise`. The `claude`, `codex`, and `omp` CLIs then register it as the `be-concise` marketplace.

The plugin loads the installed be-concise code into its daemon process, so that code runs with the daemon's access. Previews and the tuner run there too.
