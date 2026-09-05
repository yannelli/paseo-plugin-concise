import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execute = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/release.mjs", import.meta.url));

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "paseo-release-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "checkout");
  await mkdir(cwd);
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--bare", join(root, "origin.git"));
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.test");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "paseo-be-concise", version: "0.1.0" }));
  await writeFile(join(cwd, "package-lock.json"), JSON.stringify({ version: "0.1.0", packages: { "": { version: "0.1.0" } } }));
  git("add", ".");
  git("commit", "-m", "feat: add concise controls");
  git("remote", "add", "origin", join(root, "origin.git"));
  git("push", "origin", "main");
  return { cwd, git };
}

test("first dry-run selects 0.1.0 and enforces clean main checkouts", async (t) => {
  const { cwd, git } = await repository(t);
  const head = git("rev-parse", "HEAD");
  const preview = () => execute(process.execPath, [script, "--dry-run"], { cwd });
  assert.match((await preview()).stdout, /# 0\.1\.0/);
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("tag", "--list"), "");
  assert.equal(git("status", "--porcelain"), "");
  await writeFile(join(cwd, "uncommitted"), "draft");
  await assert.rejects(preview(), /checkout must be clean/);
  await rm(join(cwd, "uncommitted"));
  git("checkout", "-b", "feature");
  await assert.rejects(preview(), /Releases run from main/);
});

test("publication creates 0.1.0, repairs interrupted releases, and bumps once", async (t) => {
  const { cwd, git } = await repository(t);
  const published = new Map();
  let failNext = true;
  let attempts = 0;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer test-token");
    if (request.method === "GET") {
      const tag = request.url.split("/").at(-1);
      response.writeHead(published.has(tag) ? 200 : 404, { "Content-Type": "application/json" });
      response.end(JSON.stringify(published.get(tag) || { message: "Not Found" }));
      return;
    }
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/repos/test/concise/releases");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks));
    assert.equal(payload.prerelease, false);
    assert.doesNotMatch(payload.body, /paseo-concise-release/);
    attempts++;
    if (failNext) { failNext = false; response.writeHead(500); response.end("temporary failure"); return; }
    published.set(payload.tag_name, payload);
    response.writeHead(201, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ...payload, html_url: `https://example.test/releases/${payload.tag_name}` }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const env = { ...process.env, GH_TOKEN: "test-token", GITHUB_REPOSITORY: "test/concise", GITHUB_API_URL: `http://127.0.0.1:${server.address().port}` };
  const publish = () => execute(process.execPath, [script, "--publish"], { cwd, env });
  await assert.rejects(publish(), /HTTP 500/);
  assert.equal(git("tag", "--list"), "v0.1.0");
  assert.equal(git("cat-file", "-t", "v0.1.0"), "tag");
  assert.match(git("ls-remote", "--tags", "origin"), /refs\/tags\/v0\.1\.0/);
  const first = git("rev-parse", "HEAD");
  await publish();
  await publish();
  assert.equal(attempts, 2);
  assert.equal(git("rev-parse", "HEAD"), first);
  assert.match(published.get("v0.1.0").body, /feat: add concise controls/);
  git("commit", "--allow-empty", "-m", "fix: repair the badge");
  git("push", "origin", "main");
  failNext = true;
  await assert.rejects(publish(), /HTTP 500/);
  const released = git("rev-parse", "HEAD");
  assert.equal(git("log", "-1", "--format=%s"), "chore(release): 0.1.1");
  assert.equal(git("rev-parse", "origin/main"), git("rev-parse", "v0.1.1^{}"));
  await publish();
  await publish();
  assert.equal(attempts, 4);
  assert.equal(git("rev-parse", "HEAD"), released);
  const lock = JSON.parse(await readFile(join(cwd, "package-lock.json"), "utf8"));
  assert.equal(lock.version, "0.1.1");
  assert.equal(lock.packages[""].version, "0.1.1");
  git("commit", "--allow-empty", "-m", "docs: describe controls");
  await publish();
  assert.equal(attempts, 4);
  assert.equal(git("tag", "--list"), "v0.1.0\nv0.1.1");
});
