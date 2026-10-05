import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { createInstaller, managedRoot, type ApplyInput, type FetchJson, type Run } from "../server/installer.ts";

type FakeHost = { version: string | null; source: string | null };
const release = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, name: tag, published_at: "2026-09-29T21:58:29Z", html_url: `https://github.com/yannelli/be-concise/releases/tag/${tag}`, ...extra });
const mutations = (calls: string[][], host: string) => calls.filter(([name]) => name === host).map((call) => call.slice(1).join(" "))
  .filter((call) => call !== "plugin list" && call !== "plugin marketplace list");
async function settle(installer: ReturnType<typeof createInstaller>, input: ApplyInput) {
  await installer.apply(input);
  for (;;) {
    const status = await installer.getStatus();
    if (!status.job?.running) return { message: status.job?.message ?? "", error: status.job?.error ?? null, status };
    await new Promise((done) => setTimeout(done, 1));
  }
}
const published = [release("v0.8.2"), release("v0.8.2-beta.1"), release("v0.9.0", { prerelease: true }), release("v1.0.0", { draft: true }), release("v0.6.3"), release("nightly"), release("v0.8.1"), release("v0.7.1")];

async function writeRelease(root: string, version: string) {
  const files: Record<string, string> = {
    ".claude-plugin/marketplace.json": JSON.stringify({ name: "be-concise" }),
    ".agents/plugins/marketplace.json": JSON.stringify({ name: "be-concise" }),
    "plugins/concise/.claude-plugin/plugin.json": JSON.stringify({ name: "concise", version }),
    "plugins/concise/web/configuration.mjs": "", "plugins/concise/web/hub.mjs": "", "plugins/concise/web/testing/runner.mjs": "",
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

async function fixture(t: test.TestContext, { binaries = ["claude", "codex", "git"], hosts = {} as Partial<Record<string, FakeHost>>, cloned = (tag: string) => tag.slice(1) } = {}) {
  const root = await mkdtemp(join(tmpdir(), "paseo-concise-installer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  for (const name of binaries) {
    await writeFile(join(bin, name), "#!/bin/sh\nexit 1\n");
    await chmod(join(bin, name), 0o755);
  }
  const env = { HOME: join(root, "home"), PATH: bin, XDG_DATA_HOME: join(root, "data") };
  const state: Record<string, FakeHost> = { claude: { version: null, source: null }, codex: { version: null, source: null }, ...hosts };
  const calls: string[][] = [];
  const folderVersion = async (source: string | null) => JSON.parse(await readFile(join(source!, "plugins/concise/.claude-plugin/plugin.json"), "utf8")).version;
  const ok = (value: unknown) => ({ code: 0, stdout: `${JSON.stringify(value)}\n`, stderr: "" });
  const run: Run = async (command, args) => {
    const name = basename(command);
    calls.push([name, ...args.filter((arg) => arg !== "--json")]);
    if (name === "git") {
      const tag = args[args.indexOf("--branch") + 1];
      await writeRelease(args.at(-1)!, cloned(tag));
      await mkdir(join(args.at(-1)!, ".git"));
      return ok({});
    }
    const host = state[name];
    const action = args.slice(1, 3).join(" ");
    if (name === "claude") {
      if (action === "list --json") return ok(host.version ? [{ id: "concise@be-concise", scope: "user", version: host.version, enabled: true }] : []);
      if (action === "marketplace list") return ok(host.source ? [{ name: "be-concise", source: "directory", path: host.source }] : []);
      if (action === "marketplace add") host.source = args[3];
      if (action === "install concise@be-concise" || action === "update concise@be-concise") host.version = await folderVersion(host.source);
      if (action === "uninstall concise@be-concise") host.version = null;
      if (action === "marketplace remove") host.source = null;
      return ok({ outcome: "ok", message: "done" });
    }
    if (action === "list --json") return { code: 0, stdout: JSON.stringify({ installed: host.version ? [{ pluginId: "concise@be-concise", version: host.version, installed: true, enabled: true }] : [] }, null, 2), stderr: "WARNING: helper aliases" };
    if (action === "marketplace list") return ok({ marketplaces: host.source ? [{ name: "be-concise", root: host.source, marketplaceSource: { sourceType: "local", source: host.source } }] : [] });
    if (action === "marketplace add") {
      if (host.source && host.source !== args[3]) return { code: 1, stdout: "", stderr: "Error: marketplace 'be-concise' is already added from a different source" };
      host.source = args[3];
    }
    if (action === "marketplace remove") host.source = null;
    if (action === "add concise@be-concise") host.version = await folderVersion(host.source);
    if (action === "remove concise@be-concise") host.version = null;
    return ok({});
  };
  const fetchJson: FetchJson = async () => ({ ok: true, status: 200, json: async () => published });
  let changes = 0;
  const installer = createInstaller({ env, run, fetchJson, onChange: () => { changes++; } });
  t.after(installer.close);
  const releases = join(env.XDG_DATA_HOME, "paseo-be-concise/releases");
  return { env, state, calls, installer, releases, changes: () => changes };
}

test("status lists stable releases at or above 0.7.0 and reports missing host CLIs", async (t) => {
  const { installer } = await fixture(t, { binaries: ["claude", "git"] });
  const status = await installer.getStatus();
  assert.deepEqual(status.releases.map(({ version }) => version), ["0.8.2", "0.8.1", "0.7.1"]);
  assert.equal(status.releasesError, null);
  assert.deepEqual(status.hosts.map(({ id, available, version }) => [id, available, version]), [["claude", true, null], ["codex", false, null]]);
  assert.match(status.hosts[1].error!, /codex was not found/);
});

test("install stages each release once, updates, downgrades, and prunes older releases", async (t) => {
  const { env, calls, installer, releases, changes } = await fixture(t);
  const first = await settle(installer, { host: "claude", action: "install", version: "0.8.1" });
  const v081 = join(releases, "v0.8.1");
  assert.match(first.message, /Installed be-concise 0\.8\.1 for Claude Code\. Restart/);
  assert.deepEqual(mutations(calls, "claude"), [`plugin marketplace add ${v081}`, "plugin marketplace update be-concise", "plugin install concise@be-concise --scope user"]);
  assert.ok(calls.some((call) => call[0] === "git" && call.includes("v0.8.1") && call.includes("https://github.com/yannelli/be-concise.git")));
  assert.equal(first.status.hosts[0].version, "0.8.1");
  assert.equal(first.status.hosts[0].managed, true);
  assert.equal(await managedRoot(env), join(v081, "plugins/concise"));
  await assert.rejects(readdir(join(v081, ".git")), { code: "ENOENT" });

  const updated = await settle(installer, { host: "claude", action: "install", version: "0.8.2" });
  assert.match(updated.message, /Updated to be-concise 0\.8\.2/);
  assert.ok(calls.some((call) => call.join(" ") === "claude plugin update concise@be-concise --scope user"));
  const clones = calls.filter(([name]) => name === "git").length;
  const downgraded = await settle(installer, { host: "claude", action: "install", version: "0.8.1" });
  assert.match(downgraded.message, /Downgraded to be-concise 0\.8\.1/);
  assert.equal(calls.filter(([name]) => name === "git").length, clones);
  assert.deepEqual((await readdir(releases)).sort(), ["v0.8.1", "v0.8.2"]);
  assert.equal(await managedRoot(env), join(v081, "plugins/concise"));
  await settle(installer, { host: "claude", action: "install", version: "0.7.1" });
  assert.deepEqual((await readdir(releases)).sort(), ["v0.7.1", "v0.8.1"]);
  assert.ok(changes() >= 4);
});

test("an existing marketplace source requires an explicit switch and reports the previous source", async (t) => {
  const external = "/home/user/.codex/.tmp/marketplaces/be-concise";
  const { calls, installer, releases, state } = await fixture(t, { hosts: { codex: { version: "0.8.2", source: external } } });
  assert.match((await settle(installer, { host: "codex", action: "install", version: "0.8.2" })).error!, /reads be-concise from .*Switch to GitHub releases/);
  assert.equal(calls.filter(([name]) => name === "git").length, 0);
  const result = await settle(installer, { host: "codex", action: "install", version: "0.8.2", switchSource: true });
  assert.match(result.message, /Reinstalled be-concise 0\.8\.2 for Codex\. Start a new Codex session.*\/hooks\. Previous marketplace source: \/home\/user\/\.codex/);
  assert.deepEqual(mutations(calls, "codex"), ["plugin marketplace remove be-concise", `plugin marketplace add ${join(releases, "v0.8.2")}`, "plugin add concise@be-concise"]);
  assert.equal(state.codex.source, join(releases, "v0.8.2"));
});

test("unknown versions and mismatched release contents leave hosts unchanged", async (t) => {
  const { calls, installer, releases, state } = await fixture(t, { cloned: () => "0.8.0" });
  assert.match((await settle(installer, { host: "claude", action: "install", version: "0.9.0" })).error!, /0\.9\.0 is not a published release/);
  assert.match((await settle(installer, { host: "claude", action: "install", version: "0.8.2" })).error!, /version 0\.8\.0 does not match 0\.8\.2/);
  assert.deepEqual(await readdir(releases), []);
  assert.deepEqual(state.claude, { version: null, source: null });
  assert.deepEqual(mutations(calls, "claude"), []);
});

test("one change runs at a time and status answers from cache while it runs", async (t) => {
  const { installer } = await fixture(t);
  const before = await installer.getStatus();
  const started = await installer.apply({ host: "claude", action: "install", version: "0.8.2" });
  assert.deepEqual(started.job, { host: "claude", action: "install", version: "0.8.2", running: true, message: null, error: null });
  assert.deepEqual(started.hosts, before.hosts);
  await assert.rejects(installer.apply({ host: "codex", action: "install", version: "0.8.2" }), /Another be-concise change is running/);
  const during = await installer.getStatus();
  assert.equal(during.job?.running, true);
  assert.equal(during.checkedAt, before.checkedAt);
  await installer.close();
  await assert.rejects(installer.getStatus(), /plugin is stopping/);
});

test("remove uninstalls and removes only a managed marketplace", async (t) => {
  const external = "/home/user/.agents/plugins/be-concise";
  const { env, calls, installer, state } = await fixture(t, { hosts: { codex: { version: "0.8.2", source: external } } });
  await settle(installer, { host: "claude", action: "install", version: "0.8.2" });
  const removed = await settle(installer, { host: "claude", action: "remove" });
  assert.match(removed.message, /Removed be-concise from Claude Code/);
  assert.deepEqual(state.claude, { version: null, source: null });
  assert.deepEqual(mutations(calls, "claude").slice(-2), ["plugin uninstall concise@be-concise --scope user", "plugin marketplace remove be-concise"]);
  assert.equal(await managedRoot(env), null);
  await settle(installer, { host: "codex", action: "remove" });
  assert.deepEqual(state.codex, { version: null, source: external });
  assert.deepEqual(mutations(calls, "codex"), ["plugin remove concise@be-concise"]);
  assert.match((await settle(installer, { host: "codex", action: "remove" })).error!, /not installed for Codex/);
});
