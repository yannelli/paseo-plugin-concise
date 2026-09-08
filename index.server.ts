import type { PluginServerContext } from "@getpaseo/plugin/server";
import { eventDetail, preview, readConfiguration, snapshot, writeConfiguration } from "./shared/contracts.ts";
import { createBackend } from "./server/adapter.ts";

export default function contribute(server: PluginServerContext) {
  const backend = createBackend();
  server.handle(snapshot, backend.getSnapshot);
  server.handle(eventDetail, backend.getEventDetail);
  server.handle(readConfiguration, backend.getConfiguration);
  server.handle(writeConfiguration, backend.saveConfiguration);
  server.handle(preview, backend.runPreview);
  return backend.close;
}
