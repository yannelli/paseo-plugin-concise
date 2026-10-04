import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import type { PluginButton, PluginClientContext, PluginComposerPillContribution } from "@getpaseo/plugin/client";
import ts from "typescript";
import { readConfiguration, snapshot } from "../shared/contracts.ts";

const source = await readFile(new URL("../client/composer.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText;

type Agent = { id: string; workspaceId: string; provider: string; status: string };
type Subscription = {
  snapshot(value: { entries: { agent: Agent }[] }): void;
  update(value: { type: "agent_update"; payload: { kind: "upsert"; agent: Agent } | { kind: "remove"; agentId: string } }): void;
};

async function createHarness(directory: string | undefined = "/project") {
  const timers = new Map<number, () => void>();
  const buttons = new Map<string, PluginButton>();
  const subscribed = Promise.withResolvers<Subscription>();
  const state = { connected: true, bypassed: false, failed: false, decisions: [] as { name: string; count: number }[] };
  const workspace = { directory, async refresh() { return { workspaceDirectory: workspace.directory }; } };
  const counts = { rpc: 0, removed: 0, released: 0, unsubscribed: 0 };
  let nextTimer = 0;
  let updated = () => {};
  const exports = {} as { contributeComposer(client: PluginClientContext): () => void };
  const componentImports = new Set([
    "react/jsx-runtime", "@getpaseo/plugin/client", "@getpaseo/plugin/client/react-native",
    "@tanstack/react-query", "react", "react-native", "../shared/enforcement", "./brand", "./ui",
  ]);
  runInNewContext(compiled, {
    exports, AbortController, console,
    require(name: string) {
      if (name === "../shared/contracts") return { snapshot, readConfiguration };
      if (componentImports.has(name)) return {};
      throw new Error(`Unexpected composer import: ${name}`);
    },
    setInterval(callback: () => void) { timers.set(++nextTimer, callback); return nextTimer; },
    clearInterval(id: number) { timers.delete(id); },
  });
  const cleanup = exports.contributeComposer({
    addComposerPill({ agentId, button }: PluginComposerPillContribution) {
      buttons.set(agentId, { ...button });
      return {
        update(patch: Partial<PluginButton>) { Object.assign(buttons.get(agentId)!, patch); updated(); },
        remove() { buttons.delete(agentId); counts.removed++; },
      };
    },
    async rpc(contract: { name: string }, input: { cwd: string }) {
      counts.rpc++;
      assert.equal(input.cwd, workspace.directory);
      if (state.failed) throw new Error("RPC unavailable");
      if (contract.name === snapshot.name) return { connected: state.connected, stats: { decisions: state.decisions } };
      assert.equal(contract.name, readConfiguration.name);
      return { effective: { softFail: state.bypassed } };
    },
    paseo: {
      workspaces: { ref(id: string) { assert.equal(id, "workspace-1"); return workspace; } },
      agents: { async list() { return { subscription: {
        subscribe(subscription: Subscription) { subscribed.resolve(subscription); return () => { counts.unsubscribed++; }; },
        release() { counts.released++; },
      } }; } },
    },
  } as unknown as PluginClientContext);
  const subscription = await subscribed.promise;
  function nextUpdate() { return new Promise<void>((resolve) => { updated = resolve; }); }
  return {
    buttons, timers, state, workspace, counts, cleanup, subscription, nextUpdate,
    async poll() {
      assert.equal(timers.size, 1);
      const refreshed = nextUpdate();
      for (const callback of timers.values()) callback();
      await refreshed;
    },
  };
}

const firstAgent: Agent = { id: "agent-1", workspaceId: "workspace-1", provider: "codex", status: "running" };

function assertStatus(button: PluginButton, label: string, summary: string) {
  assert.equal(button.label, label);
  assert.equal(button.title, `Be concise · ${summary}`);
}

test("composer pill shows one attention count when enabled and Off when bypassed", { timeout: 3000 }, async (t) => {
  const harness = await createHarness();
  t.after(harness.cleanup);
  const firstUpdate = harness.nextUpdate();
  harness.subscription.snapshot({ entries: [{ agent: firstAgent }] });
  const button = harness.buttons.get(firstAgent.id)!;
  assertStatus(button, "…", "Connecting");
  await firstUpdate;
  assertStatus(button, "0", "0 rejected or flagged");
  assert.equal(typeof button.icon, "function");

  harness.state.decisions = [{ name: "allow", count: 24 }, { name: "flag", count: 4 }, { name: "ask", count: 2 }, { name: "deny", count: 3 }, { name: "block", count: 2 }];
  await harness.poll();
  assertStatus(button, "11", "11 rejected or flagged");
  assert.equal(typeof button.icon, "function");

  harness.state.decisions.push({ name: "rewrite", count: 3 }, { name: "bypass", count: 2 }, { name: "error", count: 1 });
  await harness.poll();
  assertStatus(button, "11", "11 rejected or flagged");

  harness.state.bypassed = true;
  await harness.poll();
  assertStatus(button, "Off", "Enforcement off");
  assert.equal(typeof button.icon, "function");

  harness.state.connected = false;
  await harness.poll();
  assertStatus(button, "…", "Connecting");

  harness.state.failed = true;
  await harness.poll();
  assertStatus(button, "!", "Unavailable");

  Object.assign(harness.state, { connected: true, bypassed: false, failed: false, decisions: [] });
  await harness.poll();
  assertStatus(button, "0", "0 rejected or flagged");
  assert.equal(typeof button.icon, "function");
});

test("agents sharing a workspace inherit the current label and title and share polling", { timeout: 3000 }, async (t) => {
  const harness = await createHarness();
  t.after(harness.cleanup);
  harness.state.bypassed = true;
  harness.state.decisions = [{ name: "ask", count: 12 }];
  const firstUpdate = harness.nextUpdate();
  harness.subscription.snapshot({ entries: [{ agent: firstAgent }] });
  await firstUpdate;
  assertStatus(harness.buttons.get(firstAgent.id)!, "Off", "Enforcement off");

  const secondAgent = { ...firstAgent, id: "agent-2", provider: "claude" };
  harness.subscription.update({ type: "agent_update", payload: { kind: "upsert", agent: secondAgent } });
  assertStatus(harness.buttons.get(secondAgent.id)!, "Off", "Enforcement off");
  assert.equal(harness.timers.size, 1);
  assert.equal(harness.counts.rpc, 2);

  harness.state.bypassed = false;
  await harness.poll();
  for (const button of harness.buttons.values()) {
    assertStatus(button, "12", "12 rejected or flagged");
    assert.equal(typeof button.icon, "function");
  }
  assert.equal(harness.counts.rpc, 4);

  const thirdAgent = { ...firstAgent, id: "agent-3" };
  harness.subscription.update({ type: "agent_update", payload: { kind: "upsert", agent: thirdAgent } });
  assertStatus(harness.buttons.get(thirdAgent.id)!, "12", "12 rejected or flagged");
  assert.equal(typeof harness.buttons.get(thirdAgent.id)!.icon, "function");
  harness.subscription.update({ type: "agent_update", payload: { kind: "remove", agentId: thirdAgent.id } });

  harness.subscription.update({ type: "agent_update", payload: { kind: "remove", agentId: firstAgent.id } });
  assert.equal(harness.timers.size, 1);
  harness.subscription.update({ type: "agent_update", payload: { kind: "remove", agentId: secondAgent.id } });
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.buttons.size, 0);
  assert.equal(harness.counts.removed, 3);
});

test("composer stays connecting until its workspace directory is available", { timeout: 3000 }, async (t) => {
  const harness = await createHarness();
  t.after(harness.cleanup);
  harness.workspace.directory = undefined;
  const firstUpdate = harness.nextUpdate();
  harness.subscription.snapshot({ entries: [{ agent: firstAgent }] });
  await firstUpdate;
  assertStatus(harness.buttons.get(firstAgent.id)!, "…", "Connecting");
  assert.equal(harness.counts.rpc, 0);

  harness.workspace.directory = "/project";
  await harness.poll();
  assertStatus(harness.buttons.get(firstAgent.id)!, "0", "0 rejected or flagged");
});
