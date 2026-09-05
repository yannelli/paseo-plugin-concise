import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const manifestPaths = ["package.json", "package-lock.json"];
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function readManifests(cwd) {
  const documents = await Promise.all(manifestPaths.map(async (path) => JSON.parse(await readFile(join(cwd, path), "utf8"))));
  const [pkg, lock] = documents;
  const versions = [pkg.version, lock.version, lock.packages?.[""]?.version];
  if (!versions.every((version) => typeof version === "string" && stableVersion.test(version))) throw new Error("Missing stable SemVer version in package manifests");
  if (new Set(versions).size !== 1) throw new Error("Package and lockfile versions must match");
  return documents;
}

export async function verifyConditions(_config, { cwd }) {
  const [pkg] = await readManifests(cwd);
  return pkg.version;
}

export async function prepare(_config, { cwd, nextRelease: { version } }) {
  if (!stableVersion.test(version)) throw new Error(`Invalid stable release version: ${version}`);
  const documents = await readManifests(cwd);
  documents[0].version = version;
  documents[1].version = version;
  documents[1].packages[""].version = version;
  for (const [index, path] of manifestPaths.entries()) await writeFile(join(cwd, path), `${JSON.stringify(documents[index], null, 2)}\n`);
}
