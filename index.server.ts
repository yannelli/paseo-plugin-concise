import type { PluginServerContext } from "@getpaseo/plugin/server";
import { eventDetail, installerApply, installerStatus, preview, readConfiguration, snapshot, writeConfiguration } from "./shared/contracts.ts";
import { createBackend } from "./server/adapter.ts";
import { createInstaller } from "./server/installer.ts";

export default function contribute(server: PluginServerContext) {
  const backend = createBackend();
  const installer = createInstaller({ onChange: backend.reset });
  server.handle(snapshot, backend.getSnapshot);
  server.handle(eventDetail, backend.getEventDetail);
  server.handle(readConfiguration, backend.getConfiguration);
  server.handle(writeConfiguration, backend.saveConfiguration);
  server.handle(preview, backend.runPreview);
  server.handle(installerStatus, installer.getStatus);
  server.handle(installerApply, installer.apply);
  return async () => {
    await installer.close();
    await backend.close();
  };
}
