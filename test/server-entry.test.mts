import assert from "node:assert/strict";
import test from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server.ts";
import { snapshot } from "../shared/contracts.ts";

test("server entry registers RPCs and releases each backend on cleanup", async () => {
  function start() {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const cleanup = contribute({
      handle(contract, handler) { handlers.set(contract.name, handler); },
    } as PluginServerContext);
    return { handlers, cleanup };
  }

  const first = start();
  try {
    assert.deepEqual([...first.handlers.keys()].sort(), [
      "concise.config.read", "concise.config.write", "concise.event", "concise.preview", "concise.snapshot",
    ]);
    const read = first.handlers.get(snapshot.name)!;
    const before = snapshot.output.parse(await read({}));
    assert.doesNotMatch(before.message ?? "", /plugin is stopping/);
    await assert.rejects(read({ cwd: "relative" }), /absolute project folder/);
    await first.cleanup();
    await first.cleanup();
    const after = snapshot.output.parse(await read({}));
    assert.equal(after.connected, false);
    assert.match(after.message!, /plugin is stopping/);

    const second = start();
    try {
      const reloaded = snapshot.output.parse(await second.handlers.get(snapshot.name)!({}));
      assert.doesNotMatch(reloaded.message ?? "", /plugin is stopping/);
    } finally { await second.cleanup(); }
  } finally { await first.cleanup(); }
});
