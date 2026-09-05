import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepare, verifyConditions } from "../scripts/release-manifests.mjs";
import { nextVersion, releaseNotes, releaseType } from "../scripts/release.mjs";

test("Conventional Commits select patch, minor, and major releases", () => {
  const cases = [
    ["fix: repair the badge", "patch", "0.1.1"],
    ["perf(activity): reduce reads", "patch", "0.1.1"],
    ["revert: undo a change", "patch", "0.1.1"],
    ["feat(config): add a toggle", "minor", "0.2.0"],
    ["feat(config)!: replace keys", "major", "1.0.0"],
    ["refactor: replace keys\n\nBREAKING CHANGE: rename oldKey", "major", "1.0.0"],
    ["docs: describe keys\n\nBREAKING-CHANGE: rename oldKey", "major", "1.0.0"],
    ["chore(release): 0.1.0", null, null],
    ["docs: explain setup", null, null],
    ["Update files", null, null],
  ];
  for (const [message, type, version] of cases) {
    assert.equal(releaseType(message), type);
    assert.equal(nextVersion("0.1.0", [{ message }]), version);
  }
  assert.equal(nextVersion("2.4.8", [{ message: "fix: repair" }, { message: "feat: add" }]), "2.5.0");
  assert.equal(nextVersion("2.4.8", [{ message: "feat: add" }, { message: "fix!: replace" }]), "3.0.0");
  assert.equal(nextVersion("0.1.0", []), null);
  assert.throws(() => nextVersion("01.0.0", []), /Invalid stable version/);
});

test("release notes preserve breaking details and commit references", () => {
  const notes = releaseNotes("1.0.0", "v0.1.0", [
    { hash: "1234567890", message: "feat!: replace keys\n\nBREAKING CHANGE: rename oldKey to newKey" },
    { hash: "abcdef0123", message: "fix: repair a hook" },
    { hash: "9876543210", message: "ci: check titles" },
  ]);
  assert.match(notes, /rename oldKey to newKey/);
  assert.match(notes, /1234567/);
  assert.match(notes, /fix: repair a hook/);
  assert.doesNotMatch(notes, /ci: check titles/);
  assert.match(releaseNotes("0.1.0", undefined, []), /First release/);
});

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "paseo-release-manifests-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "paseo-be-concise", version: "0.1.0", private: true }));
  await writeFile(join(cwd, "package-lock.json"), JSON.stringify({ name: "paseo-be-concise", version: "0.1.0", lockfileVersion: 3,
    packages: { "": { name: "paseo-be-concise", version: "0.1.0" }, "node_modules/example": { version: "3.2.1", integrity: "unchanged" } } }));
  return cwd;
}

test("version preparation updates package and both lockfile versions", async (t) => {
  const cwd = await fixture(t);
  await prepare({}, { cwd, nextRelease: { version: "0.2.0" } });
  assert.equal(await verifyConditions({}, { cwd }), "0.2.0");
  const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(cwd, "package-lock.json"), "utf8"));
  assert.equal(pkg.private, true);
  assert.equal(lock.version, "0.2.0");
  assert.equal(lock.packages[""].version, "0.2.0");
  assert.deepEqual(lock.packages["node_modules/example"], { version: "3.2.1", integrity: "unchanged" });
});

test("version preparation rejects drift and malformed versions before writing", async (t) => {
  const cwd = await fixture(t);
  for (const version of ["1.0", "v1.0.0", "01.0.0", "1.0.0-dev.1"]) {
    await assert.rejects(prepare({}, { cwd, nextRelease: { version } }), /Invalid stable release version/);
  }
  const file = join(cwd, "package-lock.json");
  const lock = JSON.parse(await readFile(file, "utf8"));
  lock.packages[""].version = "0.1.1";
  await writeFile(file, JSON.stringify(lock));
  await assert.rejects(prepare({}, { cwd, nextRelease: { version: "0.2.0" } }), /versions must match/);
  assert.equal(JSON.parse(await readFile(join(cwd, "package.json"), "utf8")).version, "0.1.0");
});
