import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackend, discoverInstallation } from "../server/adapter.ts";
import { enforcementUpdate } from "../shared/enforcement.ts";
import type { Configuration } from "../shared/contracts.ts";

function state(): Configuration {
  return { defaults: {}, effective: {}, environment: {}, filterLayers: [], layers: [
    { id: "user", label: "User", path: "/home/user/concise.json", text: '{"softFail":false}', exists: true, active: true, revision: "user-revision" },
    { id: "project-claude", label: "Claude", path: "/project/.claude/concise.json", text: "", exists: false, active: false, revision: null },
    { id: "project-codex", label: "Codex", path: "/project/.codex/concise.json", text: "", exists: false, active: false, revision: null },
  ] };
}

test("quick toggle creates a provider-specific project override without editing user settings", () => {
  const config = state();
  const before = structuredClone(config);
  assert.deepEqual(enforcementUpdate(config, false, "codex"), { id: "project-codex", revision: null, text: '{\n  "softFail": true\n}\n' });
  assert.equal(enforcementUpdate(config, true, "claude").id, "project-claude");
  assert.deepEqual(config, before);
});

test("quick toggle preserves the active layer, unrelated settings, and original revision", () => {
  const config = state();
  Object.assign(config.layers[1], { exists: true, active: true, revision: "original", text: '{"maxCommentLines":8,"checks":{"fileSize":false},"softFail":true}' });
  const update = enforcementUpdate(config, true, "codex");
  assert.equal(update.id, "project-claude");
  assert.equal(update.revision, "original");
  assert.deepEqual(JSON.parse(update.text), { maxCommentLines: 8, checks: { fileSize: false }, softFail: false });
});

test("quick toggle rejects malformed or redirected configuration", () => {
  for (const text of ["{", "[]", "null"]) {
    const config = state();
    Object.assign(config.layers[1], { exists: true, active: true, text });
    assert.throws(() => enforcementUpdate(config, false, "claude"), /configuration/);
  }
  const config = state();
  Object.assign(config.layers[1], { id: "project-override", active: true });
  assert.throws(() => enforcementUpdate(config, false, "claude"), /BEC_CONFIG_PATH/);
});

test("workspace bypass changes hook decisions and enabling restores enforcement", async (t) => {
  const installed = await discoverInstallation(process.env);
  if (!installed) return t.skip("be-concise 0.7.0 is required for hook coverage");
  const root = await mkdtemp(join(tmpdir(), "concise-enforcement-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  await Promise.all([mkdir(join(cwd, ".codex"), { recursive: true }), mkdir(home)]);
  await writeFile(join(cwd, ".codex/concise.json"), '{"maxCommentLines":1}');
  const backend = createBackend({ HOME: home, PATH: process.env.PATH, PASEO_CONCISE_ROOT: installed.root });
  t.after(async () => { await backend.close(); await rm(root, { recursive: true, force: true }); });
  const decisions = async () => {
    const result = await backend.runPreview({ cwd, kind: "Write", path: "example.ts", text: "// first\n// second\nconst value = 1;" });
    return JSON.parse(result.json).hooks.map((hook: { decision: string }) => hook.decision);
  };
  assert.ok((await decisions()).includes("deny"));
  const before = await backend.getConfiguration({ cwd });
  const bypass = await backend.saveConfiguration({ cwd, ...enforcementUpdate(before, false, "codex") });
  assert.equal(bypass.effective.maxCommentLines, 1);
  assert.ok(!(await decisions()).includes("deny"));
  await backend.saveConfiguration({ cwd, ...enforcementUpdate(bypass, true, "codex") });
  assert.ok((await decisions()).includes("deny"));
});
