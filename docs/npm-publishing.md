# npm publishing

Created: 2026-10-05. Last updated: 2026-10-05.

The **Release** workflow publishes `@yannelli/paseo-be-concise` to [npm](https://www.npmjs.com/package/@yannelli/paseo-be-concise) after the GitHub release step. Paseo installs it with:

```sh
paseo plugin add npm:@yannelli/paseo-be-concise
```

Paseo runs `npm install --omit=dev --ignore-scripts` on the daemon host and compiles `index.client.tsx` and `index.server.ts` itself. The tarball holds TypeScript source only, listed in `files` in `package.json`. Paseo resolves plugin modules only under `client/`, `server/`, and `shared/`. Run `npm pack --dry-run` to check the file list after you add a top-level file.

## Paseo versions

Paseo added npm plugin sources, including versions, tags, and ranges, in [0.9.0](https://github.com/getpaseo/paseo/releases/tag/v0.9.0). The source parser tests in `packages/protocol/src/plugin-source-reference.test.ts` show the pin syntax `npm:<name>@<version>`. `paseo plugin add` in Paseo 0.7.2 and 0.8.0 takes a GitHub `owner/repo` source and `--ref <branch, tag, or commit>`. Sources checked on 2026-10-05 at the `v0.7.2`, `v0.8.0`, `v0.9.0`, and `v0.10.3` tags of [getpaseo/paseo](https://github.com/getpaseo/paseo).

| Plugin tag | `paseo-plugin.json` requirement | README requirement |
| --- | --- | --- |
| `v0.2.9` | none | Paseo 0.7.2 |
| `v1.0.0` | `paseo >=0.8.0` | Paseo 0.8.0 |
| `v2.0.0` | `paseo >=0.9.0-beta.2` | Paseo 0.9.0-beta.2 or newer |
| `v2.0.1` to `v2.3.0` | `paseo >=0.9.0` | Paseo 0.9.0 or newer |

npm has 2.3.0 and later. Earlier 2.x versions install from their Git tags.

## Workflow step

The **Publish npm package** step reads the name and version from `package.json`. It runs `npm publish` when npm does not have that version yet. A rerun after a failed publish completes it. A push with no release-triggering commits skips it because npm already has the version.

`publishConfig` sets public access and provenance. The job grants `id-token: write` for the provenance statement and for trusted publishing.

## Authentication

The package has a [trusted publisher](https://docs.npmjs.com/trusted-publishers) for `release.yml` in `yannelli/paseo-plugin-concise`, added on 2026-10-05. npm CLI 11.5.1 or newer on Node.js 22.14.0 or newer exchanges the job's OIDC token for a short-lived publish token. The workflow reads no npm secret.

The trust entry names the workflow file. When you rename `release.yml` or move the publish step to another workflow, replace the entry. `npm trust` requires a 2FA login and rejects tokens that bypass 2FA:

```sh
npm login
npm trust list @yannelli/paseo-be-concise
npm trust revoke @yannelli/paseo-be-concise --id=<trust-id>
npm trust github @yannelli/paseo-be-concise --repo yannelli/paseo-plugin-concise --file <workflow>.yml --allow-publish
```

The npmjs.com equivalent is the package's **Settings → Trusted publishing**. Set **Publishing access** to require 2FA and disallow tokens, because the workflow publishes without a token.
