import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { createInstaller, managedRoot, ompRoot, readState, type ApplyInput, type FetchJson, type Run, type RunResult } from "../server/installer.ts";

type FakeHost = { version: string | null; source: string | null; enabled?: boolean };
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

const DAY = 24 * 60 * 60 * 1000;
type Options = {
  binaries?: string[]; hosts?: Partial<Record<string, FakeHost>>; cloned?: (tag: string) => string; linked?: boolean;
  respond?: (call: string) => RunResult | undefined; releases?: unknown[];
};

async function fixture(t: test.TestContext, { binaries = ["claude", "codex", "omp", "git"], hosts = {}, cloned = (tag) => tag.slice(1), linked = false, respond = () => undefined, releases: listed = published }: Options = {}) {
  const root = await mkdtemp(join(tmpdir(), "paseo-concise-installer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  for (const name of binaries) {
    await writeFile(join(bin, name), "#!/bin/sh\nexit 1\n");
    await chmod(join(bin, name), 0o755);
  }
  const env = { HOME: join(root, "home"), PATH: bin, XDG_DATA_HOME: join(root, "data") };
  if (linked) {
    await mkdir(join(root, "data-target"));
    await symlink(join(root, "data-target"), env.XDG_DATA_HOME);
  }
  const clock = { now: Date.now() };
  const signals: AbortSignal[] = [];
  const state: Record<string, FakeHost> = { claude: { version: null, source: null }, codex: { version: null, source: null }, omp: { version: null, source: null }, ...hosts };
  // omp prints marketplaces as text, so the installer reads marketplaces.json from the omp data root.
  const ompMarketplaces = async () => {
    const root = await ompRoot(env);
    await mkdir(root, { recursive: true });
    const marketplaces = state.omp.source ? [{ name: "be-concise", sourceType: "local", sourceUri: state.omp.source }] : [];
    await writeFile(join(root, "marketplaces.json"), JSON.stringify({ version: 1, marketplaces }));
  };
  if (state.omp.source) await ompMarketplaces();
  const calls: string[][] = [];
  const folderVersion = async (source: string | null) => JSON.parse(await readFile(join(source!, "plugins/concise/.claude-plugin/plugin.json"), "utf8")).version;
  const ok = (value: unknown) => ({ code: 0, stdout: `${JSON.stringify(value)}\n`, stderr: "" });
  const run: Run = async (command, args, { signal }) => {
    const name = basename(command);
    calls.push([name, ...args.filter((arg) => arg !== "--json")]);
    if (signal) signals.push(signal);
    const response = respond(calls.at(-1)!.join(" "));
    if (response) return response;
    if (name === "git") {
      const tag = args[args.indexOf("--branch") + 1];
      await writeRelease(args.at(-1)!, cloned(tag));
      await mkdir(join(args.at(-1)!, ".git"));
      return ok({});
    }
    const host = state[name];
    const action = args.slice(1, 3).join(" ");
    if (name === "omp") {
      const fail = (message: string) => ({ code: 1, stdout: `✘ ${message}\n`, stderr: "" });
      if (action === "list --json") return ok({ npm: [], marketplace: host.version ? [{ id: "concise@be-concise", scope: "user",
        entries: [{ scope: "user", installPath: `/omp/be-concise___concise___${host.version}`, version: host.version, ...(host.enabled === undefined ? {} : { enabled: host.enabled }) }] }] : [] });
      if (action === "marketplace add") {
        if (host.source) return fail('Failed to add marketplace: Error: Marketplace "be-concise" already exists');
        host.source = args[3];
      }
      if (action === "marketplace remove") host.source = null;
      if (action === "install concise@be-concise") {
        if (host.version && !args.includes("--force")) return fail('Failed to install concise@be-concise: Error: Plugin "concise@be-concise" is already installed. Use force option to reinstall.');
        host.version = await folderVersion(host.source);
      }
      if (action === "uninstall concise@be-concise") host.version = null;
      await ompMarketplaces();
      return { code: 0, stdout: "✔ done\n", stderr: "" };
    }
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
      const source = await realpath(args[3]).catch(() => args[3]);
      if (host.source && host.source !== source) return { code: 1, stdout: "", stderr: "Error: marketplace 'be-concise' is already added from a different source" };
      host.source = source;
    }
    if (action === "marketplace remove") host.source = null;
    if (action === "add concise@be-concise") host.version = await folderVersion(host.source);
    if (action === "remove concise@be-concise") host.version = null;
    return ok({});
  };
  const fetchJson: FetchJson = async () => ({ ok: true, status: 200, json: async () => listed });
  let changes = 0;
  const installer = createInstaller({ env, run, fetchJson, onChange: () => { changes++; }, now: () => clock.now });
  t.after(installer.close);
  const releases = join(env.XDG_DATA_HOME, "paseo-be-concise/releases");
  return { env, state, calls, installer, releases, clock, signals, changes: () => changes };
}

test("status lists stable releases at or above 0.7.0 and reports missing host CLIs", async (t) => {
  const { installer } = await fixture(t, { binaries: ["claude", "git"] });
  const status = await installer.getStatus();
  assert.deepEqual(status.releases.map(({ version }) => version), ["0.8.2", "0.8.1", "0.7.1"]);
  assert.equal(status.releasesError, null);
  assert.deepEqual(status.hosts.map(({ id, available, version, minimum }) => [id, available, version, minimum]), [["claude", true, null, "0.7.0"], ["codex", false, null, "0.7.0"], ["omp", false, null, "0.12.0"]]);
  assert.match(status.hosts[1].error!, /codex was not found/);
  assert.match(status.hosts[2].error!, /omp was not found/);
});

test("install stages each release once, updates, downgrades, and prunes releases unused for 7 days", async (t) => {
  const { env, calls, installer, releases, clock, changes } = await fixture(t);
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
  assert.deepEqual((await readdir(releases)).sort(), ["v0.7.1", "v0.8.1", "v0.8.2"]);
  assert.deepEqual(Object.keys((await readState(env)).retired), ["v0.8.2"]);
  clock.now += 6 * DAY;
  await installer.getStatus();
  assert.deepEqual((await readdir(releases)).sort(), ["v0.7.1", "v0.8.1", "v0.8.2"]);
  clock.now += 2 * DAY;
  await installer.getStatus();
  assert.deepEqual((await readdir(releases)).sort(), ["v0.7.1", "v0.8.1"]);
  assert.deepEqual((await readState(env)).retired, {});
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

test("a failed switch restores the earlier marketplace source", async (t) => {
  const external = "/home/user/.codex/.tmp/marketplaces/be-concise";
  const { installer, state } = await fixture(t, { hosts: { codex: { version: "0.8.1", source: external } },
    respond: (call) => call === "codex plugin add concise@be-concise" ? { code: 1, stdout: "", stderr: "Error: plugin add failed" } : undefined });
  const result = await settle(installer, { host: "codex", action: "install", version: "0.8.2", switchSource: true });
  assert.match(result.error!, /plugin add failed.*The marketplace source was restored to \/home\/user\/\.codex/);
  assert.deepEqual(state.codex, { version: "0.8.1", source: external });
});

test("a symlinked data folder keeps Codex installs managed", async (t) => {
  const { env, installer, releases, state } = await fixture(t, { linked: true });
  const first = await settle(installer, { host: "codex", action: "install", version: "0.8.1" });
  assert.equal(state.codex.source, await realpath(join(releases, "v0.8.1")));
  assert.notEqual(state.codex.source, join(releases, "v0.8.1"));
  assert.equal(first.status.hosts[1].managed, true);
  assert.equal((await readState(env)).hosts.codex?.tag, "v0.8.1");
  const updated = await settle(installer, { host: "codex", action: "install", version: "0.8.2" });
  assert.match(updated.message, /Updated to be-concise 0\.8\.2 for Codex/);
  assert.equal(updated.status.hosts[1].managed, true);
});

test("status output that is not JSON reports a host error and keeps the saved state", async (t) => {
  let broken = false;
  const { env, installer } = await fixture(t, { respond: (call) => broken && call === "claude plugin marketplace list" ? { code: 0, stdout: "Loading…\n", stderr: "" } : undefined });
  await settle(installer, { host: "claude", action: "install", version: "0.8.2" });
  broken = true;
  const status = await installer.getStatus();
  assert.match(status.hosts[0].error!, /not the expected JSON/);
  assert.equal((await readState(env)).hosts.claude?.tag, "v0.8.2");
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
  const { installer, signals } = await fixture(t);
  const before = await installer.getStatus();
  const started = await installer.apply({ host: "claude", action: "install", version: "0.8.2" });
  assert.deepEqual(started.job, { host: "claude", action: "install", version: "0.8.2", running: true, message: null, error: null });
  assert.deepEqual(started.hosts, before.hosts);
  await assert.rejects(installer.apply({ host: "codex", action: "install", version: "0.8.2" }), /Another be-concise change is running/);
  const during = await installer.getStatus();
  assert.equal(during.job?.running, true);
  assert.equal(during.checkedAt, before.checkedAt);
  await installer.close();
  assert.ok(signals.length > 0 && signals.every((signal) => signal.aborted));
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
  assert.deepEqual(Object.keys((await readState(env)).retired), ["v0.8.2"]);
  await settle(installer, { host: "codex", action: "remove" });
  assert.deepEqual(state.codex, { version: null, source: external });
  assert.deepEqual(mutations(calls, "codex"), ["plugin remove concise@be-concise"]);
  assert.match((await settle(installer, { host: "codex", action: "remove" })).error!, /not installed for Codex/);
});

const ompReleases = [release("v0.13.0"), release("v0.12.1"), release("v0.12.0"), release("v0.11.0")];

test("omp installs 0.12.0 or newer, then updates, downgrades, and reinstalls from release folders", async (t) => {
  const { env, calls, installer, releases, state } = await fixture(t, { releases: ompReleases });
  assert.match((await settle(installer, { host: "omp", action: "install", version: "0.11.0" })).error!, /omp needs be-concise 0\.12\.0 or newer/);
  assert.deepEqual(mutations(calls, "omp"), []);
  assert.equal(calls.filter(([name]) => name === "git").length, 0);

  const first = await settle(installer, { host: "omp", action: "install", version: "0.12.0" });
  assert.match(first.message, /Installed be-concise 0\.12\.0 for omp\. Start a new omp session to load it\./);
  assert.deepEqual(mutations(calls, "omp"), [`plugin marketplace add ${join(releases, "v0.12.0")}`, "plugin install concise@be-concise"]);
  const omp = first.status.hosts.find(({ id }) => id === "omp")!;
  assert.deepEqual([omp.version, omp.enabled, omp.managed, omp.source], ["0.12.0", true, true, join(releases, "v0.12.0")]);
  assert.equal((await readState(env)).hosts.omp?.tag, "v0.12.0");

  const before = mutations(calls, "omp").length;
  assert.match((await settle(installer, { host: "omp", action: "install", version: "0.13.0" })).message, /Updated to be-concise 0\.13\.0 for omp/);
  assert.deepEqual(mutations(calls, "omp").slice(before), ["plugin marketplace remove be-concise", `plugin marketplace add ${join(releases, "v0.13.0")}`, "plugin install concise@be-concise --force"]);
  assert.match((await settle(installer, { host: "omp", action: "install", version: "0.12.1" })).message, /Downgraded to be-concise 0\.12\.1 for omp/);
  assert.equal(state.omp.version, "0.12.1");
  const reinstall = mutations(calls, "omp").length;
  assert.match((await settle(installer, { host: "omp", action: "install", version: "0.12.1" })).message, /Reinstalled be-concise 0\.12\.1/);
  assert.deepEqual(mutations(calls, "omp").slice(reinstall), ["plugin install concise@be-concise --force"]);

  state.omp.enabled = false;
  assert.equal((await installer.getStatus()).hosts[2].enabled, false);
  const removed = await settle(installer, { host: "omp", action: "remove" });
  assert.match(removed.message, /Removed be-concise from omp\. Start a new omp session to unload it\./);
  assert.deepEqual(mutations(calls, "omp").slice(-2), ["plugin uninstall concise@be-concise", "plugin marketplace remove be-concise"]);
  assert.deepEqual(state.omp, { version: null, source: null, enabled: false });
  assert.equal((await readState(env)).hosts.omp, undefined);
});

test("an omp switch from the GitHub marketplace restores it on failure and remove keeps it", async (t) => {
  let failing = true;
  const { calls, installer, state } = await fixture(t, { releases: ompReleases, hosts: { omp: { version: "0.12.0", source: "yannelli/be-concise" } },
    respond: (call) => failing && call === "omp plugin install concise@be-concise --force" ? { code: 1, stdout: "✘ Failed to install concise@be-concise: Error: copy failed\n", stderr: "" } : undefined });
  const status = await installer.getStatus();
  assert.deepEqual([status.hosts[2].source, status.hosts[2].managed], ["yannelli/be-concise", false]);
  assert.match((await settle(installer, { host: "omp", action: "install", version: "0.13.0" })).error!, /reads be-concise from yannelli\/be-concise/);
  const failed = await settle(installer, { host: "omp", action: "install", version: "0.13.0", switchSource: true });
  assert.match(failed.error!, /copy failed.*The marketplace source was restored to yannelli\/be-concise/);
  assert.deepEqual(state.omp, { version: "0.12.0", source: "yannelli/be-concise" });
  failing = false;
  const removed = await settle(installer, { host: "omp", action: "remove" });
  assert.match(removed.message, /Removed be-concise from omp/);
  assert.deepEqual(state.omp, { version: null, source: "yannelli/be-concise" });
  assert.equal(mutations(calls, "omp").at(-1), "plugin uninstall concise@be-concise");
});

test("the omp data root follows OMP_PROFILE, then an existing XDG_DATA_HOME/omp, then ~/.omp", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "paseo-concise-omp-root-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  assert.equal(await ompRoot({ HOME: home, XDG_DATA_HOME: xdg }), join(home, ".omp"));
  await mkdir(join(xdg, "omp"), { recursive: true });
  assert.equal(await ompRoot({ HOME: home, XDG_DATA_HOME: xdg }), join(xdg, "omp"));
  assert.equal(await ompRoot({ HOME: home, XDG_DATA_HOME: xdg, OMP_PROFILE: "work" }), join(home, ".omp/profiles/work"));
});
