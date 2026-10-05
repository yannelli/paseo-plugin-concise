import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function load<T>(file: string): Promise<T> {
  const source = await readFile(new URL(`../client/${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {} as T;
  runInNewContext(compiled, { exports, require: () => ({}) });
  return exports;
}

type JsonObject = Record<string, unknown>;
const form = await load<{ update(source: JsonObject, path: string, value: unknown): JsonObject; mergeDelta(target: JsonObject, delta: JsonObject): JsonObject }>("config-form.tsx");
const dictionary = await load<{
  slug(value: string): string; toEntry(draft: Record<string, unknown>): JsonObject;
  draftProblem(draft: Record<string, unknown>, taken: string[]): string | null; entryErrors(message?: string): Map<number, string>;
}>("dictionary.tsx");
const playground = await load<{ hookRuns(json: string): { hook: string; decision: string; reason: string; findings: unknown[] }[]; verdict(runs: { decision: string }[]): { label: string } }>("playground.tsx");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("form edits set nested keys and drop parents left empty", () => {
  const value = form.update({ features: { emDash: { enabled: true } } }, "features.emDash.mode", "deny");
  assert.deepEqual(plain(value), { features: { emDash: { enabled: true, mode: "deny" } } });
  assert.deepEqual(plain(form.update(form.update(value, "features.emDash.mode", undefined), "features.emDash.enabled", undefined)), {});
});

test("tuner deltas merge objects, add new list items, and replace scalars", () => {
  const layer = { features: { aiWriting: { allow: ["robust"], preset: "ste" } }, maxCommentLines: 2 };
  const merged = form.mergeDelta(layer, { features: { aiWriting: { allow: ["robust", "leverage"], disablePatterns: ["hedging"] }, emDash: { enabled: false } }, maxCommentLines: 4 });
  assert.deepEqual(plain(merged), {
    features: { aiWriting: { allow: ["robust", "leverage"], preset: "ste", disablePatterns: ["hedging"] }, emDash: { enabled: false } }, maxCommentLines: 4,
  });
  assert.deepEqual(layer.features.aiWriting.allow, ["robust"]);
});

const draft = { id: "blacklist", idEdited: false, value: "blacklist", fix: "denylist", match: "exact", on: "word", caseSensitive: false, flags: "", hooks: [], scopes: [] };

test("dictionary drafts become minimal entries and report missing fields", () => {
  assert.equal(dictionary.slug("Hope this helps!"), "hope-this-helps");
  assert.match(dictionary.slug("!!!"), /^entry-[0-9a-f]{6}$/);
  assert.deepEqual(plain(dictionary.toEntry(draft)), { id: "blacklist", match: "exact", value: "blacklist", fix: "denylist" });
  assert.deepEqual(plain(dictionary.toEntry({ ...draft, match: "regex", on: "line", flags: "im", hooks: ["bash"], scopes: ["commit"] })),
    { id: "blacklist", match: "regex", value: "blacklist", fix: "denylist", flags: "im", hooks: ["bash"], scopes: ["commit"] });
  assert.deepEqual(plain(dictionary.toEntry({ ...draft, match: "endsWith", on: "line", flags: "i", caseSensitive: true })),
    { id: "blacklist", match: "endsWith", value: "blacklist", fix: "denylist", on: "line", caseSensitive: true });
  assert.equal(plain(dictionary.toEntry({ ...draft, match: "regex", flags: "m", caseSensitive: true })).caseSensitive, undefined);
  assert.equal(plain(dictionary.toEntry({ ...draft, match: "regex", caseSensitive: true })).caseSensitive, true);
  assert.equal(dictionary.draftProblem(draft, []), null);
  assert.match(dictionary.draftProblem({ ...draft, fix: " " }, [])!, /fix/);
  assert.match(dictionary.draftProblem({ ...draft, id: "Bad id" }, [])!, /lowercase/);
  assert.match(dictionary.draftProblem(draft, ["blacklist"])!, /already has/);
});

test("save errors map back to the dictionary entry they name", () => {
  const errors = dictionary.entryErrors("features.dictionary.entries[2]: value does not compile: Invalid regular expression");
  assert.deepEqual(plain([...errors]), [[2, "value does not compile: Invalid regular expression"]]);
  assert.equal(dictionary.entryErrors("maxRetries must be number").size, 0);
  assert.equal(dictionary.entryErrors(undefined).size, 0);
});

test("preview results list each hook and report the strictest decision", () => {
  const json = JSON.stringify({ hooks: [
    { hook: "check-edit", decision: "deny", durationMs: 12, findings: [{ category: "emDash", match: "—", line: 1 }],
      response: { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "[concise] 1 em dash" } } },
    { hook: "monitor-filter", decision: "allow", response: {} },
  ] });
  const runs = playground.hookRuns(json);
  assert.deepEqual(plain(runs.map(({ hook, decision, reason }) => [hook, decision, reason])), [["check-edit", "deny", "[concise] 1 em dash"], ["monitor-filter", "allow", ""]]);
  assert.equal(runs[0].findings.length, 1);
  assert.equal(playground.verdict(runs).label, "Rejected");
  assert.equal(playground.verdict([{ decision: "allow" }, { decision: "flag" }]).label, "Allowed with a notice");
  assert.equal(playground.verdict([]).label, "No hook ran");
  assert.equal(playground.hookRuns("not json").length, 0);
});

test("preview findings take the fix of their own match", () => {
  const json = JSON.stringify({
    hooks: [{ hook: "check-edit", decision: "deny", findings: [
      { category: "vocabulary", match: "comprehensive", line: 1, fix: "complete, full" },
      { category: "vocabulary", match: "seamlessly", line: 1, fix: "complete, full" },
      { category: "emDash", match: "workflow — effortlessly.", line: 1, fix: null },
    ] }],
    matches: [
      { hook: "check-edit", category: "vocabulary", match: "comprehensive", line: 1, fix: "complete, full" },
      { hook: "check-edit", category: "vocabulary", match: "seamlessly", line: 1, fix: "works without X, name X" },
      { hook: "check-edit", category: "emDash", match: "—", snippet: "workflow — effortlessly.", line: 1, fix: "Use a comma." },
    ],
  });
  const fixes = playground.hookRuns(json)[0].findings.map((finding) => (finding as { fix: string }).fix);
  assert.deepEqual(plain(fixes), ["complete, full", "works without X, name X", "Use a comma."]);
});
