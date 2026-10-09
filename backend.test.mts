import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { ActivityStore, activityStats, normalizeEvent } from "./server/activity.ts";
import { createBackend, discoverInstallation, visibleEnvironment } from "./server/adapter.ts";
import { compareVersions } from "./shared/versions.ts";
import { projectGroups, projectLabel, visibleProjects } from "./shared/projects.ts";

const record = (extra: Record<string, unknown> = {}) => ({
  cwd: "/project", hook: "check-edit", ts: "2026-09-05T10:30:00.000Z", decision: "allow",
  request: { tool_name: "Write", session_id: "session-one", tool_input: { file_path: "/project/index.ts" } }, response: {}, ...extra,
});

test("normalization bounds summaries and tolerates missing telemetry fields", () => {
  const normalized = normalizeEvent(record({
    ts: "broken", durationMs: Infinity,
    response: { hookSpecificOutput: { permissionDecisionReason: "line\n".repeat(200) } },
  }), "id", 0)!;
  assert.equal(normalized.event.timestamp, "1970-01-01T00:00:00.000Z");
  assert.equal(normalized.event.durationMs, 0);
  assert.equal(normalized.event.tool, "Write");
  assert.equal(normalized.event.session, "session-one");
  assert.equal(normalized.event.target, "/project/index.ts");
  assert.equal(normalized.event.summary.length, 280);
  assert.ok(!normalized.event.summary.includes("\n"));
  assert.equal(normalizeEvent(null, "id"), null);
  assert.equal(normalizeEvent({ cwd: "/project" }, "id"), null);
});

test("retention caps each project, removes details, and enforces total bytes", () => {
  const store = new ActivityStore(2);
  store.publish(record({ project: "a" }));
  const evicted = store.events()[0].id;
  store.publish(record({ project: "b" }));
  store.publish(record({ project: "a" }));
  store.publish(record({ project: "a" }));
  assert.equal(store.events().length, 3);
  assert.equal(store.events().filter(({ project }) => project === "a").length, 2);
  assert.throws(() => store.detail(evicted), /no longer in retained history/);
  assert.equal(JSON.parse(store.detail(store.events()[0].id)).hook, "check-edit");
  const bounded = new ActivityStore(500, 1600);
  for (let index = 0; index < 6; index++) bounded.publish(record({ project: String(index), padding: "x".repeat(650) }));
  assert.equal(bounded.events().length, 1);
  bounded.publish(record({ padding: "x".repeat(2 * 1024 * 1024) }));
  assert.equal(bounded.events().length, 1);
  bounded.clear();
  assert.deepEqual(bounded.events(), []);
});

test("stats count interventions, sessions, durations, and thirty minute buckets", () => {
  const now = Date.parse("2026-09-05T10:30:45.000Z");
  const samples = [
    record({ decision: "deny", durationMs: 10 }),
    record({ decision: "ask", durationMs: 20, session: "session-two" }),
    record({ decision: "block", durationMs: 30, hook: "check-reply", ts: "2026-09-05T10:29:00.000Z" }),
    record({ decision: "rewrite", durationMs: 40, ts: "2026-09-05T09:00:00.000Z" }),
  ].map((value, index) => normalizeEvent(value, String(index), now)!.event);
  const stats = activityStats(samples, now);
  assert.equal(stats.total, 4);
  assert.equal(stats.interventions, 3);
  assert.equal(stats.sessions, 2);
  assert.equal(stats.averageMs, 25);
  assert.deepEqual(stats.hooks[0], { name: "check-edit", count: 3 });
  assert.equal(stats.minutes.length, 30);
  assert.equal(stats.minutes.at(-1)!.count, 2);
  assert.equal(stats.minutes.at(-2)!.count, 1);
  assert.equal(stats.minutes.reduce((sum, minute) => sum + minute.count, 0), 3);
  assert.equal(activityStats([]).averageMs, 0);
});

test("injected session rules count as context while config warnings stay flagged", () => {
  const lifecycle = (response: Record<string, unknown>, decision = "flag") => normalizeEvent(record({
    hook: "session-context", event: "SessionStart", decision, request: { hook_event_name: "SessionStart", session_id: "s" }, response,
  }), "id")!.event;
  const rules = lifecycle({ hookSpecificOutput: { additionalContext: "[concise] Active rules:" } });
  assert.equal(rules.decision, "context");
  assert.equal(rules.tool, "SessionStart");
  assert.equal(lifecycle({ systemMessage: "[concise] config problem", hookSpecificOutput: { additionalContext: "rules" } }).decision, "flag");
  assert.equal(lifecycle({}, "bypass").decision, "bypass");
  assert.equal(normalizeEvent(record({ decision: "flag", response: { systemMessage: "kept" } }), "id")!.event.decision, "flag");
  assert.equal(activityStats([rules]).interventions, 0);
});

test("environment output includes valid supported flags and excludes arbitrary values", () => {
  assert.deepEqual(visibleEnvironment({
    BEC_MONITOR_PERSIST: "0", BEC_FEATURE_ALWAYS_ENABLE: "aiWriting,comments", BEC_LOG_MAX_SIZE: "5m",
    BEC_CONFIG_JSON: '{"secret":"hidden"}', BEC_CONFIG_PATH: "/private/path", BEC_API_KEY: "secret",
    BEC_LOG_ENABLED: "secret", BEC_FEATURE_DISABLE: "api-token", BEC_ALLOW_PHRASES: "private phrase",
  }), { BEC_MONITOR_PERSIST: "0", BEC_FEATURE_ALWAYS_ENABLE: "aiWriting,comments", BEC_LOG_MAX_SIZE: "5m" });
  assert.deepEqual(visibleEnvironment({ BEC_FEATURE_ENABLE: "dictionary,emDash" }), { BEC_FEATURE_ENABLE: "dictionary,emDash" });
  assert.deepEqual(visibleEnvironment({ BEC_FEATURE_DISABLE: "shellWrites, tasks", BEC_CONFIG_PATH_ONLY: "1", BEC_FEATURE_ENABLE: "scan" }),
    { BEC_FEATURE_DISABLE: "shellWrites, tasks", BEC_CONFIG_PATH_ONLY: "1" });
});

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "paseo-concise-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "project");
  const home = join(root, "home");
  await Promise.all([mkdir(cwd), mkdir(home)]);
  return { root, cwd, home, env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH, PASEO_CONCISE_ROOT: join(root, "missing") } };
}

async function fakeInstallation(root: string, version = "0.7.0", projects: unknown[] = []) {
  const files: Record<string, string> = {
    ".claude-plugin/plugin.json": JSON.stringify({ name: "concise", version }),
    "web/configuration.mjs": "export function configuration() {}\nexport function saveConfiguration() {}\n",
    "web/hub.mjs": `export function createHub() { return { list: () => ${JSON.stringify(projects)}, close() {} }; }\n`,
    "web/testing/runner.mjs": "export async function runTest() {}\nexport async function disposeTests() {}\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

test("missing installations recover on refresh and cleanup stops backend access", async (t) => {
  const { env, root } = await fixture(t);
  const backend = createBackend(env);
  t.after(backend.close);
  const missing = await backend.getSnapshot();
  assert.equal(missing.connected, false);
  assert.match(missing.message!, /0\.7\.0/);
  await assert.rejects(backend.getEventDetail({ id: "absent" }), /Install be-concise/);
  await fakeInstallation(join(root, "missing"));
  assert.equal((await backend.getSnapshot()).connected, true);
  await backend.close();
  await assert.rejects(backend.getConfiguration({ cwd: root }), /plugin is stopping/);
});

test("discovery respects configured cache homes and rejects older installations", async (t) => {
  const { root, home } = await fixture(t);
  const codex = join(root, "codex");
  const claude = join(root, "claude");
  await fakeInstallation(join(codex, "plugins/cache/be-concise/concise/0.6.3"), "0.6.3");
  const current = join(claude, "plugins/cache/be-concise/concise/0.7.1");
  await fakeInstallation(current, "0.7.1");
  const found = await discoverInstallation({ HOME: home, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude });
  assert.equal(found!.root, await realpath(current));
  assert.equal(found!.version, "0.7.1");
});

test("the newest managed release wins discovery and reset reloads the runtime", async (t) => {
  const { root, home } = await fixture(t);
  const data = join(root, "data");
  const env = { HOME: home, XDG_DATA_HOME: data, CLAUDE_CONFIG_DIR: join(root, "claude") };
  await fakeInstallation(join(root, "claude/plugins/cache/be-concise/concise/0.8.2"), "0.8.2");
  const releases = join(data, "paseo-be-concise/releases");
  await fakeInstallation(join(releases, "v0.8.1/plugins/concise"), "0.8.1");
  await fakeInstallation(join(releases, "v0.8.2/plugins/concise"), "0.8.2");
  const select = (claude: string, codex: string) => writeFile(join(data, "paseo-be-concise/state.json"), JSON.stringify({ hosts: {
    claude: { tag: claude, updatedAt: "2026-10-05T02:00:00.000Z" }, codex: { tag: codex, updatedAt: "2026-10-05T01:00:00.000Z" },
  } }));
  await select("v0.8.2", "v0.8.1");
  const backend = createBackend(env);
  t.after(backend.close);
  assert.equal((await backend.getSnapshot()).version, "0.8.2");
  await select("v0.8.1", "v0.8.2");
  assert.equal((await backend.getSnapshot()).version, "0.8.2");
  await backend.reset();
  const reloaded = await backend.getSnapshot();
  assert.equal(reloaded.version, "0.8.1");
  assert.equal(reloaded.root, await realpath(join(releases, "v0.8.1/plugins/concise")));
});

test("project filtering resolves directory aliases", async (t) => {
  const { root, cwd } = await fixture(t);
  const alias = join(root, "alias");
  await symlink(cwd, alias);
  const store = new ActivityStore();
  store.publish(record({ cwd: alias }));
  assert.equal(store.events(cwd).length, 1);
  assert.equal(store.events(join(root, "unrelated")).length, 0);
});

test("upstream config edits preserve layers, mode, and conflicting revisions", async (t) => {
  const installed = await discoverInstallation(process.env);
  if (!installed) return t.skip("be-concise >=0.7.0 is required for upstream integration coverage");
  const { cwd, home, env } = await fixture(t);
  env.PASEO_CONCISE_ROOT = installed.root;
  const userPath = join(home, ".config/concise/concise.json");
  await mkdir(dirname(userPath), { recursive: true });
  const original = '{"maxCommentLines":4,"checks":{"prBody":false}}\n';
  await writeFile(userPath, original);
  await chmod(userPath, 0o640);
  const backend = createBackend(env);
  t.after(backend.close);
  const initial = await backend.getConfiguration({ cwd });
  assert.equal(initial.effective.maxCommentLines, 4);
  const input = { cwd, id: "project-codex", text: '{"maxCommentLines":7}', revision: null };
  const concurrent = await Promise.allSettled([backend.saveConfiguration(input), backend.saveConfiguration({ ...input, text: '{"maxCommentLines":8}' })]);
  assert.equal(concurrent.filter(({ status }) => status === "fulfilled").length, 1);
  assert.match(String((concurrent.find(({ status }) => status === "rejected") as PromiseRejectedResult).reason), /changed on disk/);
  assert.equal(await readFile(userPath, "utf8"), original);
  const state = await backend.getConfiguration({ cwd });
  assert.ok([7, 8].includes(state.effective.maxCommentLines as number));
  const layer = state.layers.find(({ id }) => id === "project-codex")!;
  await assert.rejects(backend.saveConfiguration({ ...input, text: '{"checks":{"comments":"false"}}', revision: layer.revision }), /must be boolean/);
  await assert.rejects(backend.getConfiguration({ cwd: "relative" }), /absolute project/);
  await assert.rejects(backend.saveConfiguration({ cwd, id: "filter-claude", text: "FILTER_LINES=$(touch unsafe)", revision: null }), /non-negative integer/);
  const userLayer = state.layers.find(({ id }) => id === "user")!;
  await backend.saveConfiguration({ cwd, id: "user", text: '{"maxCommentLines":5}', revision: userLayer.revision });
  assert.equal((await stat(userPath)).mode & 0o777, 0o640);
  assert.equal((await backend.getConfiguration({ cwd })).effective.maxCommentLines, state.effective.maxCommentLines);
});

test("preview isolates sessions and leaves pasted commands and project files unexecuted", async (t) => {
  const installed = await discoverInstallation(process.env);
  if (!installed) return t.skip("be-concise >=0.7.0 is required for upstream integration coverage");
  const { cwd, env } = await fixture(t);
  env.PASEO_CONCISE_ROOT = installed.root;
  const backend = createBackend(env);
  t.after(backend.close);
  const preview = (text: string) => backend.runPreview({ cwd, kind: "Write", path: "draft.md", text });
  const first = JSON.parse((await preview("// first\n// second\n// third\nconst value = 1;")).json);
  const second = JSON.parse((await preview("Clean wording.")).json);
  assert.notEqual(first.session, second.session);
  assert.ok(Array.isArray(first.hooks));
  await assert.rejects(stat(join(cwd, "draft.md")), { code: "ENOENT" });
  await backend.runPreview({ cwd, kind: "Bash", path: "", text: "npm test && touch paseo-preview-marker" });
  await assert.rejects(stat(join(cwd, "paseo-preview-marker")), { code: "ENOENT" });
  assert.equal((await backend.getSnapshot()).events.length, 0);
});

test("the tuner requires be-concise 0.10.0 and proposes settings from pasted samples", async (t) => {
  const { root, cwd, env } = await fixture(t);
  await fakeInstallation(join(root, "missing"), "0.9.0");
  const older = createBackend(env);
  t.after(older.close);
  await assert.rejects(older.runTune({ cwd, kind: "docs", texts: ["Text."] }), /requires be-concise 0\.10\.0 or newer\. This host has 0\.9\.0/);
  const installed = await discoverInstallation(process.env);
  if (!installed || compareVersions(installed.version, "0.10.0") < 0) return t.skip("be-concise >=0.10.0 is required for tuner coverage");
  const backend = createBackend({ ...env, PASEO_CONCISE_ROOT: installed.root });
  t.after(backend.close);
  const sample = "The parser reads each file \u2014 then it writes the index. ".repeat(40);
  const result = await backend.runTune({ cwd, kind: "docs", texts: [sample, sample] });
  assert.equal(result.samples, 2);
  assert.ok(result.words > 300);
  assert.ok(result.evidence.every((item) => typeof item.key === "string" && typeof item.reason === "string"));
  assert.equal(typeof result.delta, "object");
  await assert.rejects(stat(join(cwd, ".claude/concise.json")), { code: "ENOENT" });
  await assert.rejects(backend.runTune({ cwd, kind: "essay" as "docs", texts: ["Text."] }), /^Error: unknown kind "essay"/);
});

test("settings written by the 0.10 controls pass upstream validation and name the bad entry", async (t) => {
  const installed = await discoverInstallation(process.env);
  if (!installed || compareVersions(installed.version, "0.10.0") < 0) return t.skip("be-concise >=0.10.0 is required for 0.10 settings coverage");
  const { cwd, env } = await fixture(t);
  env.PASEO_CONCISE_ROOT = installed.root;
  const backend = createBackend(env);
  t.after(backend.close);
  const layer = {
    context: { perTurn: true }, subagentStop: { exemptAgentTypes: ["Explore"] }, testFilter: { codexPostToolUse: true },
    features: { dictionary: { mode: "deny", entries: [
      { id: "blacklist", match: "exact", value: "blacklist", fix: "denylist" },
      { id: "ticket", match: "regex", value: "\\bJIRA-\\d+\\b", fix: "link the ticket", flags: "i", scopes: ["commit"] },
    ] } },
    ignoreGlobs: ["**/dist/**"], allowList: { phrases: ["load-bearing"] }, log: { rotate: "daily", maxSize: "1m", maxFiles: 2 },
  };
  const saved = await backend.saveConfiguration({ cwd, id: "project-claude", text: JSON.stringify(layer), revision: null });
  const effective = saved.effective as typeof layer & { problems: unknown[] };
  assert.equal(effective.context.perTurn, true);
  assert.deepEqual(effective.subagentStop.exemptAgentTypes, ["Explore"]);
  assert.deepEqual(effective.features.dictionary.entries.map(({ id }) => id), ["blacklist", "ticket"]);
  assert.deepEqual(effective.ignoreGlobs, ["**/dist/**"]);
  assert.deepEqual(effective.problems, []);
  const revision = saved.layers.find(({ id }) => id === "project-claude")!.revision;
  const broken = { features: { dictionary: { entries: [{ id: "ok", match: "exact", value: "a", fix: "b" }, { id: "bad", match: "regex", value: "(", fix: "c" }] } } };
  await assert.rejects(backend.saveConfiguration({ cwd, id: "project-claude", text: JSON.stringify(broken), revision }), /features\.dictionary\.entries\[1\]: value does not compile/);
});

// Records written by the be-concise 0.12.0 omp extension (omp/extension.mjs) and its hooks, with paths shortened.
const ompRecords = [
  { ts: "2026-10-07T18:48:22.381Z", hook: "session-context", event: "SessionStart", tool: null, session: "019a2b3c-omp-session", cwd: "/work/proj", decision: "flag", durationMs: 3, error: null,
    request: { hook_event_name: "SessionStart", session_id: "019a2b3c-omp-session", cwd: "/work/proj" },
    response: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "[concise] Active rules:" } }, source: "live" },
  { ts: "2026-10-07T18:48:22.443Z", hook: "check-edit", event: "PreToolUse", tool: "Write", session: "019a2b3c-omp-session", cwd: "/work/proj", decision: "flag", durationMs: 21, error: null,
    request: { hook_event_name: "PreToolUse", session_id: "019a2b3c-omp-session", cwd: "/work/proj", tool_name: "Write", tool_input: { file_path: "/work/proj/notes.md", content: "This is a robust — seamless tool.\n" } },
    response: { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "[concise] soft-fail: 1 em dash, 2 AI writing patterns in /work/proj/notes.md." } }, source: "live" },
  { ts: "2026-10-07T18:48:22.565Z", hook: "check-edit", event: "PreToolUse", tool: "apply_patch", session: "019a2b3c-omp-session", cwd: "/work/proj", decision: "flag", durationMs: 21, error: null,
    request: { hook_event_name: "PreToolUse", session_id: "019a2b3c-omp-session", cwd: "/work/proj", tool_name: "apply_patch", tool_input: { input: "*** Begin Patch\n*** Add File: a.md\n+Hello — world\n*** End Patch" } },
    response: { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "[concise] soft-fail: 1 em dash in /work/proj/a.md." } }, source: "live" },
];

test("omp records normalize like Claude Code and Codex records, including patch targets in tool_input.input", () => {
  const [rules, write, patch] = ompRecords.map((value, index) => normalizeEvent(value, String(index))!.event);
  assert.deepEqual([rules.tool, rules.decision, rules.session], ["SessionStart", "context", "019a2b3c-omp-session"]);
  assert.deepEqual([write.tool, write.decision, write.target], ["Write", "flag", "/work/proj/notes.md"]);
  assert.equal(patch.tool, "apply_patch");
  assert.equal(patch.target, "*** Begin Patch *** Add File: a.md +Hello — world *** End Patch");
  assert.match(patch.summary, /1 em dash in \/work\/proj\/a\.md/);
  assert.equal(activityStats([rules, write, patch]).sessions, 1);
});

test("discovery finds omp caches in the default, profile, and XDG data roots", async (t) => {
  const { root, home } = await fixture(t);
  const xdg = join(root, "xdg");
  const cache = (base: string, version: string) => join(base, "plugins/cache/plugins", `be-concise___concise___${version}`);
  await fakeInstallation(cache(join(home, ".omp"), "0.12.0"), "0.12.0");
  await fakeInstallation(cache(join(home, ".omp/profiles/work"), "0.12.1"), "0.12.1");
  await fakeInstallation(join(home, ".omp/plugins/cache/plugins/other___concise___0.13.0"), "0.13.0");
  const env = { HOME: home, XDG_DATA_HOME: xdg, CLAUDE_CONFIG_DIR: join(root, "claude"), CODEX_HOME: join(root, "codex") };
  assert.equal((await discoverInstallation(env))!.version, "0.12.1");
  const newest = cache(join(xdg, "omp"), "0.12.2");
  await fakeInstallation(newest, "0.12.2");
  assert.equal((await discoverInstallation(env))!.root, await realpath(newest));
});

test("snapshots keep the 0.11.0 project fields and the picker hides missing projects by repository", async (t) => {
  const { root, env } = await fixture(t);
  const repo = { name: "app", root: "/src/app", worktree: null, subdir: "" };
  await fakeInstallation(join(root, "installed"), "0.11.0", [
    { key: "a", name: "app", cwd: "/src/app", lastSeen: "3", missing: false, repo },
    { key: "b", name: "fix-bug", cwd: "/trees/fix-bug", lastSeen: "2", missing: true, repo: { ...repo, worktree: "fix-bug" } },
    { key: "c", name: "notes", cwd: "/notes", lastSeen: "1", missing: false, repo: null },
    { key: "d", name: "docs", cwd: "/src/app/docs", lastSeen: "0", repo: { name: 7 } },
  ]);
  const backend = createBackend({ ...env, PASEO_CONCISE_ROOT: join(root, "installed") });
  t.after(backend.close);
  const { projects } = await backend.getSnapshot();
  assert.deepEqual(projects.map(({ key, missing, repo: value }) => [key, missing, value?.worktree ?? value?.name ?? value]), [["a", false, "app"], ["b", true, "fix-bug"], ["c", false, null], ["d", false, null]]);
  assert.deepEqual(projects.map(projectLabel), ["app", "fix-bug (worktree) (missing)", "notes", "docs"]);
  assert.deepEqual(projectGroups(visibleProjects(projects, false, "")).map(({ label, projects: items }) => [label, items.map(({ key }) => key)]), [["app", ["a"]], ["No git repository", ["c", "d"]]]);
  assert.deepEqual(visibleProjects(projects, false, "/trees/fix-bug").map(({ key }) => key), ["a", "b", "c", "d"]);
  assert.deepEqual(projectGroups([{ key: "e", name: "old", cwd: "/old", lastSeen: "" }]), [{ id: "", label: null, projects: [{ key: "e", name: "old", cwd: "/old", lastSeen: "" }] }]);
});

test("records from the be-concise 0.14.0 tool text and notebook hooks name their target", () => {
  const target = (tool: string, input: Record<string, unknown>) => normalizeEvent(record({ hook: "check-tool-text", request: { tool_name: tool, session_id: "s", tool_input: input } }), "id")!.event;
  assert.equal(target("NotebookEdit", { notebook_path: "/project/n.ipynb", new_source: "x" }).target, "/project/n.ipynb");
  assert.equal(target("ExitPlanMode", { plan: "Step one.\nStep two." }).target, "Step one. Step two.");
  assert.equal(target("TaskCreate", { subject: "Fix the build", description: "Long text" }).target, "Fix the build");
  const post = target("mcp__github__create_issue", { title: "Bug", body: "Details" });
  assert.deepEqual([post.tool, post.target], ["mcp__github__create_issue", "Bug"]);
});

test("settings written by the 0.14 scan controls and the code scope pass upstream validation", async (t) => {
  const installed = await discoverInstallation(process.env);
  if (!installed || compareVersions(installed.version, "0.14.0") < 0) return t.skip("be-concise >=0.14.0 is required for scan settings coverage");
  const { cwd, env } = await fixture(t);
  const backend = createBackend({ ...env, PASEO_CONCISE_ROOT: installed.root });
  t.after(backend.close);
  const before = await backend.getConfiguration({ cwd });
  assert.deepEqual(Object.keys((before.defaults as { scan: object }).scan).sort(), ["codeFiles", "heredocWrites", "mcp", "notebooks", "plans", "questions", "shellWrites", "tasks"]);
  const layer = { scan: { shellWrites: false, tasks: false }, features: { dictionary: { entries: [{ id: "todo", match: "contains", value: "TODO", fix: "file an issue", scopes: ["code"] }] } } };
  const saved = await backend.saveConfiguration({ cwd, id: "project-claude", text: JSON.stringify(layer), revision: null });
  const effective = saved.effective as { scan: Record<string, boolean>; problems: unknown[] };
  assert.deepEqual([effective.scan.shellWrites, effective.scan.tasks, effective.scan.plans], [false, false, true]);
  assert.deepEqual(effective.problems, []);
});

test("from be-concise 0.13.1, BEC_CONFIG_PATH is its own layer under the user and project files", async (t) => {
  const installed = await discoverInstallation(process.env);
  if (!installed || compareVersions(installed.version, "0.13.1") < 0) return t.skip("be-concise >=0.13.1 is required for the env-config layer");
  const { root, cwd, env } = await fixture(t);
  await writeFile(join(root, "shared.json"), '{"maxCommentLines":7,"maxFileLines":100}');
  await mkdir(join(cwd, ".claude"));
  await writeFile(join(cwd, ".claude/concise.json"), '{"maxFileLines":200}');
  const backend = createBackend({ ...env, PASEO_CONCISE_ROOT: installed.root, BEC_CONFIG_PATH: "../shared.json" });
  t.after(backend.close);
  const state = await backend.getConfiguration({ cwd });
  assert.deepEqual(state.layers.filter(({ active }) => active).map(({ id }) => id), ["env-config", "project-claude"]);
  assert.equal(state.layers[0].path, join(root, "shared.json"));
  assert.deepEqual([state.effective.maxCommentLines, state.effective.maxFileLines], [7, 200]);
});
