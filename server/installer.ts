import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, constants, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import type { HostId, HostStatus, InstallerStatus } from "../shared/contracts.ts";
import { compareVersions } from "../shared/versions.ts";

type Environment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;
type Release = InstallerStatus["releases"][number];
type HostState = { tag: string; previous?: string; updatedAt: string };
type State = { hosts: Partial<Record<HostId, HostState>>; retired: Record<string, string> };
type Host = HostStatus & { binary: string | null; tag: string | null };
type Job = NonNullable<InstallerStatus["job"]>;
export type RunResult = { code: number; stdout: string; stderr: string };
export type Run = (command: string, args: string[], options: { env: Environment; signal?: AbortSignal }) => Promise<RunResult>;
export type FetchJson = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export type ApplyInput = { host: HostId; action: "install" | "remove"; version?: string; switchSource?: boolean };

export const REPOSITORY = "yannelli/be-concise";
const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`;
const CLONE_URL = `https://github.com/${REPOSITORY}.git`;
const MARKETPLACE = "be-concise";
const PLUGIN = "concise@be-concise";
const MINIMUM = "0.7.0";
const TAG = /^v\d+\.\d+\.\d+$/;
const CACHE_MS = 10 * 60 * 1000;
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000;
const HOSTS: HostId[] = ["claude", "codex", "omp"];
const LABELS: Record<HostId, string> = { claude: "Claude Code", codex: "Codex", omp: "omp" };
// omp loads omp/extension.mjs, which be-concise added in 0.12.0.
const MINIMUMS: Record<HostId, string> = { claude: MINIMUM, codex: MINIMUM, omp: "0.12.0" };
const NOTICES: Record<HostId, string> = {
  claude: "Restart Claude Code sessions to load it.",
  codex: "Start a new Codex session and review the concise hooks with /hooks.",
  omp: "Start a new omp session to load it.",
};
const UNLOADS: Record<HostId, string> = {
  claude: "Restart Claude Code sessions to unload it.",
  codex: "Start a new Codex session to unload it.",
  omp: "Start a new omp session to unload it.",
};
const REMOVES: Record<HostId, string[]> = {
  claude: ["plugin", "uninstall", PLUGIN, "--scope", "user"], codex: ["plugin", "remove", PLUGIN], omp: ["plugin", "uninstall", PLUGIN],
};

const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter(object) : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const failure = (error: unknown) => error instanceof Error ? error.message : String(error);
const canonical = (path: string) => realpath(path).catch(() => resolve(path));
const lastLine = (value: string) => value.trim().split("\n").filter((line) => line.trim() && !line.startsWith("WARNING")).at(-1) ?? "";

export function dataDirectory(env: Environment): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  return join(env.XDG_DATA_HOME || join(home, ".local/share"), "paseo-be-concise");
}
const releasesDirectory = (env: Environment) => join(dataDirectory(env), "releases");
const statePath = (env: Environment) => join(dataDirectory(env), "state.json");

// A profile wins over XDG_DATA_HOME; XDG_DATA_HOME/omp is used only when it exists (checked with omp 18.7.0).
export async function ompRoot(env: Environment): Promise<string> {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (env.OMP_PROFILE) return join(home, ".omp/profiles", env.OMP_PROFILE);
  const xdg = env.XDG_DATA_HOME ? join(env.XDG_DATA_HOME, "omp") : null;
  return xdg && await stat(xdg).then((entry) => entry.isDirectory(), () => false) ? xdg : join(home, ".omp");
}

export async function readState(env: Environment): Promise<State> {
  try {
    const value: unknown = JSON.parse(await readFile(statePath(env), "utf8"));
    const hosts = object(value) && object(value.hosts) ? value.hosts : {};
    const retired = object(value) && object(value.retired) ? value.retired : {};
    return { hosts: Object.fromEntries(HOSTS.flatMap((id) => {
      const entry = hosts[id];
      return object(entry) && TAG.test(text(entry.tag)) ? [[id, { tag: text(entry.tag), previous: TAG.test(text(entry.previous)) ? text(entry.previous) : undefined, updatedAt: text(entry.updatedAt) }]] : [];
    })), retired: Object.fromEntries(Object.entries(retired).flatMap(([tag, since]) => TAG.test(tag) && typeof since === "string" ? [[tag, since]] : [])) };
  } catch { return { hosts: {}, retired: {} }; }
}

async function writeState(env: Environment, state: State) {
  await mkdir(dataDirectory(env), { recursive: true });
  const temporary = `${statePath(env)}.${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporary, statePath(env));
}

export async function managedRoot(env: Environment): Promise<string | null> {
  const latest = Object.values((await readState(env)).hosts).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return latest ? join(releasesDirectory(env), latest.tag, "plugins/concise") : null;
}

export async function locate(name: string, env: Environment): Promise<string | null> {
  const home = env.HOME || env.USERPROFILE || homedir();
  for (const directory of [...(env.PATH || "").split(delimiter).filter(Boolean), join(home, ".local/bin"), join(home, ".bun/bin")]) {
    const file = join(directory, process.platform === "win32" ? `${name}.exe` : name);
    try {
      await access(file, constants.X_OK);
      if ((await stat(file)).isFile()) return file;
    } catch {}
  }
  return null;
}

export const runCommand: Run = (command, args, { env, signal }) => new Promise((done, fail) => {
  execFile(command, args, { env: { ...env, GIT_TERMINAL_PROMPT: "0" }, signal, timeout: 180_000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
    if (error && typeof error.code === "string") fail(new Error(`${basename(command)} failed: ${error.message}`));
    else done({ code: error ? Number(error.code ?? 1) || 1 : 0, stdout, stderr: error?.killed ? `${stderr}\nTimed out after 180 seconds.` : stderr });
  });
});

function parseJson(stdout: string): unknown {
  for (const candidate of [stdout.trim(), lastLine(stdout)]) {
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}

async function validate(root: string, version: string) {
  const read = async (path: string): Promise<JsonObject> => {
    const value: unknown = JSON.parse(await readFile(join(root, path), "utf8"));
    return object(value) ? value : {};
  };
  const [claude, codex, plugin] = await Promise.all([
    read(".claude-plugin/marketplace.json"), read(".agents/plugins/marketplace.json"), read("plugins/concise/.claude-plugin/plugin.json"),
  ]);
  if (claude.name !== MARKETPLACE || codex.name !== MARKETPLACE) throw new Error("The release does not contain the be-concise marketplace.");
  if (plugin.name !== "concise" || plugin.version !== version) throw new Error(`The release plugin version ${text(plugin.version) || "is missing and"} does not match ${version}.`);
  await Promise.all(["web/configuration.mjs", "web/hub.mjs", "web/testing/runner.mjs"].map((file) => stat(join(root, "plugins/concise", file))));
}

export function createInstaller({ env = process.env, run = runCommand, fetchJson = fetch as FetchJson, onChange = async () => {}, now = Date.now }: {
  env?: Environment; run?: Run; fetchJson?: FetchJson; onChange?: () => Promise<void> | void; now?: () => number;
} = {}) {
  const releasesRoot = releasesDirectory(env);
  const stopping = new AbortController();
  let cache: { at: number; releases: Release[]; error: string | null } = { at: 0, releases: [], error: null };
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  let job: Job | null = null;
  let last: InstallerStatus | null = null;

  function serial<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error("The plugin is stopping. Reopen it after reload."));
    const next = queue.catch(() => {}).then(operation);
    queue = next;
    return next;
  }

  // A bun global install of omp starts with #!/usr/bin/env bun, and bun sits next to it.
  async function cli(binary: string, args: string[]): Promise<unknown> {
    const result = await run(binary, [...args, "--json"], { env: { ...env, PATH: [dirname(binary), env.PATH].filter(Boolean).join(delimiter) }, signal: stopping.signal });
    const value = parseJson(result.stdout);
    if (result.code === 0 && (!object(value) || value.outcome === undefined || value.outcome === "ok")) return value;
    const reason = object(value) && typeof value.message === "string" ? value.message : lastLine(result.stderr) || lastLine(result.stdout);
    throw new Error(`${basename(binary)} ${args.join(" ")} failed: ${reason || `exit ${result.code}`}`);
  }

  async function releases(refresh = false): Promise<Release[]> {
    if (!refresh && cache.at && Date.now() - cache.at < CACHE_MS) return cache.releases;
    try {
      const response = await fetchJson(RELEASES_URL, { headers: { accept: "application/vnd.github+json", "user-agent": "paseo-be-concise" }, signal: AbortSignal.any([stopping.signal, AbortSignal.timeout(15_000)]) });
      if (!response.ok) throw new Error(`GitHub releases returned HTTP ${response.status}.`);
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error("GitHub releases returned an unexpected response.");
      const found = list(body).filter((release) => !release.draft && !release.prerelease && TAG.test(text(release.tag_name)) && compareVersions(text(release.tag_name), MINIMUM) >= 0)
        .map((release) => ({ tag: text(release.tag_name), version: text(release.tag_name).slice(1), name: text(release.name) || text(release.tag_name), publishedAt: text(release.published_at), url: text(release.html_url) }))
        .sort((a, b) => compareVersions(b.version, a.version));
      cache = { at: Date.now(), releases: found, error: null };
    } catch (error) {
      cache = { ...cache, error: `Unable to read GitHub releases: ${failure(error)}` };
    }
    return cache.releases;
  }

  // Codex reports marketplace paths with symlinks resolved.
  async function managedTag(source: string | null): Promise<string | null> {
    if (!source) return null;
    const [root, target] = await Promise.all([canonical(releasesRoot), canonical(source)]);
    return dirname(target) === root && TAG.test(basename(target)) ? basename(target) : null;
  }

  async function cliState(id: HostId, binary: string): Promise<{ plugin?: JsonObject; source: string | null }> {
    const [plugins, marketplaces] = await Promise.all([cli(binary, ["plugin", "list"]), cli(binary, ["plugin", "marketplace", "list"])]);
    const expected = id === "claude" ? Array.isArray : object;
    if (!expected(plugins) || !expected(marketplaces)) throw new Error(`${id} plugin list --json returned output that is not the expected JSON.`);
    const plugin = id === "claude"
      ? list(plugins).find((entry) => entry.id === PLUGIN && entry.scope === "user")
      : list(object(plugins) ? plugins.installed : []).find((entry) => entry.pluginId === PLUGIN && entry.installed !== false);
    const marketplace = list(id === "claude" ? marketplaces : object(marketplaces) ? marketplaces.marketplaces : []).find((entry) => entry.name === MARKETPLACE);
    const origin = object(marketplace?.marketplaceSource) ? marketplace.marketplaceSource.source : undefined;
    return { plugin, source: marketplace ? text(id === "claude" ? marketplace.path || marketplace.repo || marketplace.url || marketplace.installLocation : origin || marketplace.root) || null : null };
  }

  // omp prints its marketplace list as text, so the sources come from marketplaces.json.
  async function ompState(binary: string): Promise<{ plugin?: JsonObject; source: string | null }> {
    const plugins = await cli(binary, ["plugin", "list"]);
    if (!object(plugins) || !Array.isArray(plugins.marketplace)) throw new Error("omp plugin list --json returned output that is not the expected JSON.");
    const entries = list(plugins.marketplace).find((entry) => entry.id === PLUGIN)?.entries;
    const plugin = list(entries).find((entry) => entry.scope === "user");
    const file = join(await ompRoot(env), "marketplaces.json");
    let marketplaces: unknown = {};
    try { marketplaces = JSON.parse(await readFile(file, "utf8")); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Unable to read ${file}: ${failure(error)}`);
    }
    const marketplace = list(object(marketplaces) ? marketplaces.marketplaces : []).find((entry) => entry.name === MARKETPLACE);
    return { plugin, source: text(marketplace?.sourceUri) || null };
  }

  async function host(id: HostId): Promise<Host> {
    const base: Host = { id, label: LABELS[id], available: false, version: null, enabled: false, source: null, managed: false, error: null, minimum: MINIMUMS[id], binary: null, tag: null };
    const binary = await locate(id, env);
    if (!binary) return { ...base, error: `${id} was not found on the daemon PATH.` };
    try {
      const { plugin, source } = id === "omp" ? await ompState(binary) : await cliState(id, binary);
      const tag = await managedTag(source);
      return { ...base, binary, available: true, version: text(plugin?.version) || null, enabled: plugin?.enabled !== false && Boolean(plugin), source, managed: Boolean(tag), tag };
    } catch (error) {
      return { ...base, binary, available: true, error: failure(error) };
    }
  }

  async function reconcile(hosts: Host[]) {
    const state = await readState(env);
    let changed = false;
    for (const entry of hosts.filter((item) => item.available && !item.error)) {
      const { tag } = entry;
      const current = state.hosts[entry.id];
      if (tag === (current?.tag ?? null)) continue;
      changed = true;
      if (tag) state.hosts[entry.id] = { tag, previous: current?.tag, updatedAt: new Date().toISOString() };
      else delete state.hosts[entry.id];
    }
    if (changed) {
      await writeState(env, state);
      await onChange();
    }
  }

  async function report(refresh = false): Promise<InstallerStatus> {
    const [found, hosts] = await Promise.all([releases(refresh), Promise.all(HOSTS.map(host))]);
    await reconcile(hosts);
    await prune();
    last = {
      repository: REPOSITORY, directory: releasesRoot, releases: found, releasesError: cache.error,
      checkedAt: new Date().toISOString(), hosts: hosts.map(({ binary: _binary, tag: _tag, ...entry }) => entry), job: null,
    };
    return withJob(last);
  }

  function withJob(status: InstallerStatus | null): InstallerStatus {
    const base = status ?? { repository: REPOSITORY, directory: releasesRoot, releases: cache.releases, releasesError: cache.error, checkedAt: new Date().toISOString(), hosts: [], job: null };
    return { ...base, job: job ? { ...job } : null };
  }

  async function stage(release: Release): Promise<string> {
    const target = join(releasesRoot, release.tag);
    try { await validate(target, release.version); return target; } catch {}
    const git = await locate("git", env);
    if (!git) throw new Error("Install Git on the daemon host to download be-concise releases.");
    await mkdir(releasesRoot, { recursive: true });
    const staging = join(releasesRoot, `.staging-${randomUUID()}`);
    try {
      const result = await run(git, ["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", release.tag, "--", CLONE_URL, staging], { env, signal: stopping.signal });
      if (result.code !== 0) throw new Error(`git clone ${release.tag} failed: ${lastLine(result.stderr) || `exit ${result.code}`}`);
      await validate(staging, release.version);
      await rm(join(staging, ".git"), { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
      await rename(staging, target);
      return target;
    } finally { await rm(staging, { recursive: true, force: true }); }
  }

  // Claude Code sessions load the plugin from the release folder, so an unused folder stays for RETAIN_MS.
  async function prune() {
    const state = await readState(env);
    const keep = new Set(Object.values(state.hosts).flatMap((entry) => [entry.tag, entry.previous]));
    const retired: Record<string, string> = {};
    for (const name of (await readdir(releasesRoot).catch(() => [] as string[])).filter((entry) => TAG.test(entry) && !keep.has(entry)).sort()) {
      const since = state.retired[name] ?? new Date(now()).toISOString();
      if (now() - Date.parse(since) < RETAIN_MS) retired[name] = since;
      else await rm(join(releasesRoot, name), { recursive: true, force: true });
    }
    if (JSON.stringify(retired) !== JSON.stringify(state.retired)) await writeState(env, { ...state, retired });
  }

  async function install(id: HostId, version: string | undefined, switchSource: boolean): Promise<string> {
    const pick = (found: Release[]) => version ? found.find((item) => item.version === version) : found[0];
    const release = pick(await releases()) ?? pick(await releases(true));
    if (!release) throw new Error(cache.error ?? `${version ? `be-concise ${version}` : "No be-concise version"} is not a published release at or above ${MINIMUM}.`);
    if (compareVersions(release.version, MINIMUMS[id]) < 0) throw new Error(`${LABELS[id]} needs be-concise ${MINIMUMS[id]} or newer.`);
    const current = await host(id);
    if (!current.binary || current.error) throw new Error(current.error ?? `${LABELS[id]} is unavailable.`);
    if (current.source && !current.managed && !switchSource) {
      throw new Error(`${LABELS[id]} reads be-concise from ${current.source}. Choose Switch to GitHub releases to replace that marketplace source.`);
    }
    const directory = await stage(release);
    const { binary } = current;
    const external = current.source && !current.managed ? current.source : null;
    const pointed = current.tag === release.tag;
    try {
      if (id === "claude") {
        await cli(binary, ["plugin", "marketplace", "add", directory]);
        await cli(binary, ["plugin", "marketplace", "update", MARKETPLACE]);
        await cli(binary, ["plugin", current.version ? "update" : "install", PLUGIN, "--scope", "user"]);
      } else {
        if (current.source && !pointed) await cli(binary, ["plugin", "marketplace", "remove", MARKETPLACE]);
        if (!pointed) await cli(binary, ["plugin", "marketplace", "add", directory]);
        await cli(binary, id === "codex" ? ["plugin", "add", PLUGIN] : ["plugin", "install", PLUGIN, ...(current.version ? ["--force"] : [])]);
      }
    } catch (error) {
      if (!external) throw error;
      const restore = async () => {
        if (id !== "claude") await cli(binary, ["plugin", "marketplace", "remove", MARKETPLACE]).catch(() => {});
        await cli(binary, ["plugin", "marketplace", "add", external]);
      };
      const restored = await restore().then(() => true, () => false);
      throw new Error(`${failure(error)} ${restored ? "The marketplace source was restored to" : "The marketplace source before this change was"} ${external}.`);
    }
    const state = await readState(env);
    const previous = state.hosts[id];
    state.hosts[id] = { tag: release.tag, previous: previous?.tag === release.tag ? previous.previous : previous?.tag, updatedAt: new Date().toISOString() };
    await writeState(env, state);
    await onChange();
    const verb = !current.version ? "Installed" : compareVersions(release.version, current.version) > 0 ? "Updated to" : compareVersions(release.version, current.version) < 0 ? "Downgraded to" : "Reinstalled";
    const switched = external ? ` Previous marketplace source: ${external}.` : "";
    return `${verb} be-concise ${release.version} for ${LABELS[id]}. ${NOTICES[id]}${switched}`;
  }

  async function remove(id: HostId): Promise<string> {
    const current = await host(id);
    if (!current.binary || current.error) throw new Error(current.error ?? `${LABELS[id]} is unavailable.`);
    if (!current.version && !current.managed) throw new Error(`be-concise is not installed for ${LABELS[id]}.`);
    if (current.version) await cli(current.binary, REMOVES[id]);
    if (current.managed) await cli(current.binary, ["plugin", "marketplace", "remove", MARKETPLACE]);
    const state = await readState(env);
    delete state.hosts[id];
    await writeState(env, state);
    await onChange();
    return `Removed be-concise from ${LABELS[id]}. ${UNLOADS[id]}`;
  }

  async function start(input: ApplyInput): Promise<InstallerStatus> {
    if (job?.running) throw new Error("Another be-concise change is running. Wait for it to finish.");
    const current: Job = { host: input.host, action: input.action, version: input.version ?? null, running: true, message: null, error: null };
    job = current;
    void serial(async () => {
      try {
        current.message = input.action === "install" ? await install(input.host, input.version, Boolean(input.switchSource)) : await remove(input.host);
      } catch (error) {
        current.error = failure(error);
      } finally { current.running = false; }
      await report().catch(() => {});
    }).catch(() => {});
    return withJob(last);
  }

  return {
    getStatus: ({ refresh }: { refresh?: boolean } = {}) => job?.running ? Promise.resolve(withJob(last)) : serial(() => report(refresh)),
    apply: (input: ApplyInput) => closed ? Promise.reject(new Error("The plugin is stopping. Reopen it after reload.")) : start(input),
    async close() {
      closed = true;
      stopping.abort();
      await queue.catch(() => {});
    },
  };
}
