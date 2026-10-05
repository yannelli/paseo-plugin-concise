# npm publishing

Created: 2026-10-05. Last updated: 2026-10-05.

The **Release** workflow publishes `@yannelli/paseo-be-concise` to [npm](https://www.npmjs.com/package/@yannelli/paseo-be-concise) after the GitHub release step. Paseo installs it with:

```sh
paseo plugin add npm:@yannelli/paseo-be-concise
```

Paseo runs `npm install --omit=dev --ignore-scripts` on the daemon host and compiles `index.client.tsx` and `index.server.ts` itself. The tarball holds TypeScript source only, listed in `files` in `package.json`. Paseo resolves plugin modules only under `client/`, `server/`, and `shared/`. Run `npm pack --dry-run` to check the file list after you add a top-level file.

## Workflow step

The **Publish npm package** step reads the name and version from `package.json`. It runs `npm publish` when npm does not have that version yet. A rerun after a failed publish completes it. A push with no release-triggering commits skips it because npm already has the version.

`publishConfig` sets public access and provenance. The job grants `id-token: write` for the provenance statement and for trusted publishing.

## Authentication

npm CLI 11.5.1 or newer on Node.js 22.14.0 or newer tries [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) first. Without a trusted publisher on the package, it uses `NODE_AUTH_TOKEN`, which the step reads from the `NPM_TOKEN` repository secret. The current token is a granular token scoped to `@yannelli` that expires on 2027-01-03.

`npm trust` rejects tokens that bypass 2FA, and the package must exist on npm. To add the trusted publisher, sign in with 2FA and run:

```sh
npm login
npm trust github @yannelli/paseo-be-concise --repo yannelli/paseo-plugin-concise --file release.yml --allow-publish
npm trust list @yannelli/paseo-be-concise
```

Or open the package on npmjs.com, then **Settings → Trusted publishing**, and add GitHub Actions, with owner `yannelli`, repository `paseo-plugin-concise`, and workflow `release.yml`. After the next release publishes through OIDC, delete the `NPM_TOKEN` secret and set **Publishing access** to require 2FA and disallow tokens.
