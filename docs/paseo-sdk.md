# Paseo plugin SDK 0.13 to 0.16

Created: 2026-11-19. Last updated: 2026-11-19.

This page lists the Paseo plugin APIs this plugin uses, the oldest Paseo version that has each one, and the rules from the Paseo plugin docs that the repository follows. Sources, read on 2026-11-19: the [plugin quickstart](https://paseo.sh/docs/plugins), [reference](https://paseo.sh/docs/plugins/reference), [publishing](https://paseo.sh/docs/plugins/publishing), and [migration](https://paseo.sh/docs/plugins/migration) pages, the `@getpaseo/plugin` 0.10.2 to 0.16.2 type definitions on npm, and the project that `paseo plugin init` 0.16.2 writes. Read them again before you change a contribution or raise the Paseo requirement.

## Requirement

`paseo-plugin.json` requires Paseo `>=0.13.0`. Each connected app also checks the range before it runs client code. Plugin 2.x required `>=0.9.0` and used the APIs in the deprecated column below.

| API | Since | Replaces (deprecated) |
| --- | --- | --- |
| `client.addScreen({ id, title, Component })`, `PluginScreenProps` | 0.11.0 | `addSurface(id, Component)`, `PluginSurfaceProps` |
| `client.addSidebarHeaderItem({ id, title, Component })` with `SidebarRow` from `@getpaseo/plugin/client/ui` | 0.11.0 | `addSidebarItem({ id, title, icon, surface })` |
| `openScreen({ screenId })` in Command Center callbacks | 0.11.0 | `openSurface(id)` |
| `Icon` and `useToast` from `@getpaseo/plugin/client/ui` | 0.13.0 | `@getpaseo/plugin/client/react-native`, which Paseo removes after 2027-04-20 |
| `addWorkspacePanel` without `context` | 0.13.0 | `context: "workspace"`, removed after 2027-04-23 |
| `tab.setModified(modified)` on panel props | 0.13.0 | none |
| Manifest `name` | 0.11.0 | none |

The screen and the sidebar item both use the id `main`, which the deprecated sidebar item used, so saved links keep working.

## How the plugin uses them

- The sidebar row shows the rejected and flagged count across all projects, as the composer pill does for one workspace. It polls `concise.snapshot` with `summary: true` every 10 seconds. A summary snapshot leaves out the events and keeps the stats of the whole retained window. The pill uses the same flag every 3 seconds.
- The workspace panel calls `tab.setModified` while the selected project has unsaved configuration drafts, so Paseo shows the unsaved dot and asks before the tab closes.
- The Plugin tab shows a toast when a background install or remove finishes.

## Repository rules

- `OVERVIEW.md` sits beside `paseo-plugin.json` and is in `files`. The Paseo registry requires it for every version bump. It describes what the plugin does, setup, and what it reads and sends. It must not contain installation commands; the registry validator rejects `paseo plugin add`, `npm install`, and `npm i`.
- Code modules belong in `client/`, `server/`, or `shared/`. Tests are in `test/`.
- `tsconfig.json` checks the client and `shared/` without the DOM library, as the scaffold does. The React Native types declare a global `AbortSignal` without `any` and `timeout`, so `tsconfig.server.json` checks `server/`, `shared/`, and `index.server.ts` with the Node.js types only. `npm run typecheck` runs both.
- `@getpaseo/plugin` in `devDependencies` matches the scaffold version (0.16.2). Paseo supplies the SDK, React, React Native, TanStack Query, and Zod at runtime.

## Not used yet

- `addWorkspaceRowBadgeItem` (0.16.0) could show the count on each workspace row. It needs Paseo 0.16.0.
- `defineSubscription` (in the 0.16.2 SDK, absent from 0.15.0) could push activity in place of the 2-second poll. It needs Paseo 0.16 and a server-side change feed.
- `defineSettings` and `addSettingsScreen` for plugin settings. The plugin has no settings of its own.
