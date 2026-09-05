import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface, WorkspacePanel } from "./main.client";
import { eventDetail, preview, readConfiguration, serverCleanups, snapshot, writeConfiguration } from "./contracts.shared";
import { getConfiguration, getEventDetail, getSnapshot, runPreview, saveConfiguration } from "./adapter.server";
import { contributeComposer } from "./composer.client";

export default function contribute(plugin: PluginContext) {
  plugin.handle(snapshot, getSnapshot);
  plugin.handle(eventDetail, getEventDetail);
  plugin.handle(readConfiguration, getConfiguration);
  plugin.handle(writeConfiguration, saveConfiguration);
  plugin.handle(preview, runPreview);
  plugin.addClientSide(contributeComposer);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({ id: "main", title: "Be concise", icon: "IterationCw", surface: "main" });
  plugin.addWorkspacePanel({ id: "workspace", title: "Be concise", icon: "IterationCw", context: "workspace", locations: ["workspace", "explorer"], Component: WorkspacePanel });
  plugin.addCommandCenterItem({ id: "open", title: "Be concise: activity and configuration", icon: "IterationCw", context: "global",
    keywords: ["concise", "rules", "stats", "hooks"], onSelect({ openSurface }) { openSurface("main"); } });
  plugin.addCommandCenterItem({ id: "open-workspace", title: "Be concise: this workspace", icon: "IterationCw", context: "workspace",
    keywords: ["concise", "rules", "stats", "hooks"], onSelect({ openPanel }) { openPanel("workspace"); } });
  return async () => {
    for (const cleanup of serverCleanups) await cleanup();
    serverCleanups.clear();
  };
}
