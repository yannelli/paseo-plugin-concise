import { spawn } from "node:child_process";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ActivityStore, activityStats, RETAINED } from "./activity.ts";
import type { Configuration, TuneKind, TuneResult } from "../shared/contracts.ts";
import { compareVersions as compare } from "../shared/versions.ts";
import { managedRoot } from "./installer.ts";

type Environment = Record<string, string | undefined>;
type Project = { key: string; name: string; cwd: string; lastSeen: string; missing?: boolean; repo?: unknown };
type Hub = { list(): Project[]; close(): void };
type SaveInput = { cwd: string; id: string; text: string; revision: string | null };
type PreviewInput = { cwd: string; kind: "Write" | "apply_patch" | "Bash" | "Stop"; text: string; path: string };
type TuneInput = { cwd: string; kind: TuneKind; texts: string[]; preset?: string };
type ConfigurationModule = {
  configuration(cwd: string, env: Environment): Configuration;
  saveConfiguration(cwd: string, env: Environment, input: Omit<SaveInput, "cwd">): void;
};
type Runner = { runTest(input: PreviewInput & { env: Environment; config: Record<string, unknown> }): Promise<unknown>; disposeTests(): Promise<void> };
type Runtime = { root: string; version: string; config: ConfigurationModule; runner: Runner; hub: Hub };
const MISSING = "Install be-concise 0.7.0 or newer for Claude Code or Codex, or 0.12.0 or newer for omp, on this host. For a source checkout, set PASEO_CONCISE_ROOT to its folder, then reload this plugin.";
const BOOLEAN_FLAGS = new Set([
  "BEC_HOOK_SOFT_FAIL", "BEC_DISABLE_STOP_HOOK", "BEC_MONITOR_PERSIST", "BEC_MONITOR_DISABLED",
  "BEC_LOG_ENABLED", "BEC_LOG_USE_JSON", "BEC_LOG_USE_PLAINTEXT",
]);

export function visibleEnvironment(env: Environment): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => {
    const [key, value] = entry;
    if (typeof value !== "string" || value.length > 200) return false;
    if (BOOLEAN_FLAGS.has(key)) return /^(1|0|true|false|yes|no|on|off)$/i.test(value.trim());
    if (["BEC_FEATURE_ENABLE", "BEC_FEATURE_DISABLE", "BEC_FEATURE_ALWAYS_ENABLE", "BEC_FEATURE_ALWAYS_DISABLE"].includes(key)) {
      return value.split(",").every((id) => ["emDash", "aiWriting", "dictionary", "comments", "fileSize", "prBody", "stopHook"].includes(id.trim()));
    }
    if (key === "BEC_LOG_MAX_SIZE") return /^\d+(?:\.\d+)?\s*[bkmg]?b?$/i.test(value.trim());
    if (key === "BEC_LOG_MAX_FILES") return /^\d+$/.test(value);
    return key === "BEC_LOG_ROTATE" && ["none", "size", "daily", "both"].includes(value);
  }));
}

type Installation = { root: string; version: string };

const listDirectory = (path: string) => readdir(path).catch(() => [] as string[]);

// omp copies each installed version to <root>/plugins/cache/plugins/be-concise___concise___<version>.
async function ompCaches(env: Environment, home: string): Promise<string[]> {
  const base = join(home, ".omp");
  const roots = [base, ...(await listDirectory(join(base, "profiles"))).map((name) => join(base, "profiles", name))];
  if (env.XDG_DATA_HOME) roots.push(join(env.XDG_DATA_HOME, "omp"));
  const caches = await Promise.all(roots.map(async (root) => {
    const cache = join(root, "plugins/cache/plugins");
    return (await listDirectory(cache)).filter((name) => name.startsWith("be-concise___concise___")).map((name) => join(cache, name));
  }));
  return caches.flat();
}

async function inspect(candidate: string): Promise<Installation | null> {
  for (const manifest of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"]) {
    try {
      const { name, version } = JSON.parse(await readFile(join(candidate, manifest), "utf8"));
      if (name !== "concise" || typeof version !== "string" || !/^v?\d+\.\d+\.\d+$/.test(version) || compare(version, "0.7.0") < 0) continue;
      await Promise.all(["web/configuration.mjs", "web/hub.mjs", "web/testing/runner.mjs"].map((file) => stat(join(candidate, file))));
      return { root: await realpath(candidate), version };
    } catch {}
  }
  return null;
}

export async function discoverInstallation(env: Environment): Promise<Installation | null> {
  const candidates: string[] = [];
  if (env.PASEO_CONCISE_ROOT) candidates.push(resolve(env.PASEO_CONCISE_ROOT), resolve(env.PASEO_CONCISE_ROOT, "plugins/concise"));
  else {
    const managed = await managedRoot(env);
    const preferred = managed ? await inspect(managed) : null;
    if (preferred) return preferred;
    const home = env.HOME || env.USERPROFILE || homedir();
    const caches = [join(env.CODEX_HOME || join(home, ".codex"), "plugins/cache/be-concise/concise"),
      join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "plugins/cache/be-concise/concise")];
    await Promise.all(caches.map(async (cache) => { candidates.push(...(await listDirectory(cache)).map((name) => join(cache, name))); }));
    candidates.push(...await ompCaches(env, home));
  }
  const found = await Promise.all(candidates.map(inspect));
  return found.filter((value): value is Installation => value !== null).sort((a, b) => compare(b.version, a.version))[0] || null;
}

// be-concise 0.11.0 added missing and repo; older hubs omit both, so their projects count as present.
function projectSummary(project: Project) {
  const repo = project.repo && typeof project.repo === "object" ? project.repo as Record<string, unknown> : null;
  const valid = repo && typeof repo.name === "string" && typeof repo.root === "string";
  return {
    key: project.key, name: String(project.name || "Project"), cwd: project.cwd, lastSeen: String(project.lastSeen || ""), missing: project.missing === true,
    repo: project.repo === undefined ? undefined : valid ? { name: String(repo.name), root: String(repo.root), worktree: typeof repo.worktree === "string" ? repo.worktree : null, subdir: typeof repo.subdir === "string" ? repo.subdir : "" } : null,
  };
}

async function target(cwd: string): Promise<string> {
  if (!isAbsolute(cwd)) throw new Error("Choose an absolute project folder.");
  try {
    const canonical = await realpath(cwd);
    if ((await stat(canonical)).isDirectory()) return canonical;
  } catch {}
  throw new Error("The project folder does not exist on this host.");
}

const TUNE_SCRIPT = `import { readFileSync } from "node:fs";
const { url, options } = JSON.parse(readFileSync(0, "utf8"));
const { tune } = await import(url);
process.stdout.write(JSON.stringify(await tune(options)));`;
const OUTPUT_LIMIT = 8 * 1024 * 1024;

// Project pattern packs are JavaScript, so the tuner loads them in a child process.
function runTuner(input: unknown, cwd: string, env: Environment): Promise<TuneResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", TUNE_SCRIPT], { cwd, env, stdio: ["pipe", "pipe", "pipe"], timeout: 60_000 });
    const output: Buffer[] = [];
    let size = 0;
    let errors = "";
    child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > OUTPUT_LIMIT) child.kill(); else output.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { errors = `${errors}${chunk}`.slice(-4096); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) return reject(new Error(/^\w*Error: (.+)$/m.exec(errors)?.[1] ?? `The tuner stopped (${signal ?? code}).`));
      try { resolveResult(JSON.parse(Buffer.concat(output).toString("utf8"))); } catch { reject(new Error("The tuner returned invalid output.")); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

const projectEnvironment = (env: Environment, cwd: string): Environment => ({ ...env,
  ...(env.BEC_CONFIG_PATH ? { BEC_CONFIG_PATH: resolve(cwd, env.BEC_CONFIG_PATH) } : {}),
});

export function createBackend(env: Environment = process.env) {
  const activity = new ActivityStore();
  const saves = new Map<string, Promise<unknown>>();
  let runtime: Runtime | null = null;
  let loading: Promise<Runtime | null> | null = null;
  let previews: Promise<unknown> = Promise.resolve();
  let resets: Promise<unknown> = Promise.resolve();
  let closed = false;

  async function connect(): Promise<Runtime | null> {
    if (closed) throw new Error("The plugin is stopping. Reopen it after reload.");
    await resets;
    if (closed) throw new Error("The plugin is stopping. Reopen it after reload.");
    if (runtime) return runtime;
    if (!loading) loading = (async () => {
      const installation = await discoverInstallation(env);
      if (!installation) return null;
      const moduleAt = (file: string) => import(pathToFileURL(join(installation.root, file)).href);
      const [config, hubModule, runner] = await Promise.all([
        moduleAt("web/configuration.mjs"), moduleAt("web/hub.mjs"), moduleAt("web/testing/runner.mjs"),
      ]);
      if (typeof config.configuration !== "function" || typeof config.saveConfiguration !== "function" || typeof hubModule.createHub !== "function" || typeof runner.runTest !== "function" || typeof runner.disposeTests !== "function") {
        throw new Error("This be-concise installation does not provide the expected 0.7.0 APIs.");
      }
      if (closed) return null;
      const hub = hubModule.createHub({ ...env }, { retained: RETAINED, publish: (record: unknown) => activity.publish(record) }) as Hub;
      runtime = { ...installation, config: config as ConfigurationModule, runner: runner as Runner, hub };
      return runtime;
    })().finally(() => { loading = null; });
    return loading;
  }

  async function requireRuntime(): Promise<Runtime> {
    const active = await connect();
    if (!active) throw new Error(MISSING);
    return active;
  }

  function configuration(active: Runtime, cwd: string): Configuration {
    const state = active.config.configuration(cwd, projectEnvironment(env, cwd));
    return { ...state, environment: visibleEnvironment(state.environment) };
  }

  async function getSnapshot({ cwd }: { cwd?: string } = {}) {
    const selected = cwd ? await target(cwd) : undefined;
    let message: string | null = null;
    let active: Runtime | null = null;
    try { active = await connect(); } catch (error) { message = error instanceof Error ? error.message : "Unable to read be-concise on this host."; }
    const events = activity.events(selected);
    return {
      connected: Boolean(active), version: active?.version || null, root: active?.root || null,
      message: active ? null : message || MISSING,
      projects: active?.hub.list().map(projectSummary) || [],
      events, stats: activityStats(events), updatedAt: new Date().toISOString(), retainedLimit: RETAINED,
    };
  }

  async function getEventDetail({ id }: { id: string }) { await requireRuntime(); return { json: activity.detail(id) }; }
  async function getConfiguration({ cwd }: { cwd: string }) { return configuration(await requireRuntime(), await target(cwd)); }

  async function saveConfiguration(input: SaveInput) {
    const active = await requireRuntime();
    const cwd = await target(input.cwd);
    const state = configuration(active, cwd);
    const layer = [...state.layers, ...state.filterLayers].find(({ id }) => id === input.id);
    if (!layer) throw new Error("Unknown configuration layer.");
    let key = layer.path;
    try { key = await realpath(key); } catch {}
    const previous = saves.get(key) || Promise.resolve();
    const operation = previous.catch(() => {}).then(() => {
      active.config.saveConfiguration(cwd, projectEnvironment(env, cwd), input);
      return configuration(active, cwd);
    });
    saves.set(key, operation);
    try { return await operation; } finally { if (saves.get(key) === operation) saves.delete(key); }
  }

  async function runPreview(input: PreviewInput) {
    const active = await requireRuntime();
    const cwd = await target(input.cwd);
    const operation = previews.catch(() => {}).then(async () => {
      try {
        const result = await active.runner.runTest({ ...input, cwd, env: projectEnvironment(env, cwd), config: configuration(active, cwd).effective });
        return { json: JSON.stringify(result) };
      } finally { await active.runner.disposeTests(); }
    });
    previews = operation;
    return operation;
  }

  async function runTune(input: TuneInput) {
    const active = await requireRuntime();
    const cwd = await target(input.cwd);
    if (compare(active.version, "0.10.0") < 0) throw new Error(`The writing tuner requires be-concise 0.10.0 or newer. This host has ${active.version}.`);
    const samples = input.texts.map((text, index) => ({ name: `Sample ${index + 1}`, text }));
    const options = { samples, kind: input.kind, cwd, config: configuration(active, cwd).effective, preset: input.preset || undefined };
    return runTuner({ url: pathToFileURL(join(active.root, "tools/tune.mjs")).href, options }, cwd, projectEnvironment(env, cwd));
  }

  // connect waits for resets, so a new runtime cannot share a runner that is being disposed.
  function reset() {
    const operation = resets.then(async () => {
      if (closed) return;
      await loading?.catch(() => {});
      const previous = runtime;
      runtime = null;
      if (!previous) return;
      previous.hub.close();
      activity.clear();
      await Promise.allSettled([...saves.values(), previews]);
      await previous.runner.disposeTests();
    });
    resets = operation.catch(() => {});
    return operation;
  }

  async function close() {
    if (closed) return;
    closed = true;
    await resets;
    await loading?.catch(() => {});
    runtime?.hub.close();
    await Promise.allSettled([...saves.values(), previews]);
    await runtime?.runner.disposeTests();
    activity.clear();
    runtime = null;
  }

  return { getSnapshot, getEventDetail, getConfiguration, saveConfiguration, runPreview, runTune, reset, close };
}
