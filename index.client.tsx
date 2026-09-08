import type { PluginClientContext } from "@getpaseo/plugin/client";
import { MainSurface, WorkspacePanel } from "./client/main";
import { contributeComposer } from "./client/composer";

export default function contribute(client: PluginClientContext) {
  client.addSurface("main", MainSurface);
  client.addSidebarItem({ id: "main", title: "Be concise", icon: "IterationCw", surface: "main" });
  client.addWorkspacePanel({ id: "workspace", title: "Be concise", icon: "IterationCw", context: "workspace", locations: ["workspace", "explorer"], Component: WorkspacePanel });
  client.addCommandCenterItem({ id: "open", title: "Be concise: activity and configuration", icon: "IterationCw", context: "global",
    keywords: ["concise", "rules", "stats", "hooks"], onSelect({ openSurface }) { openSurface("main"); } });
  client.addCommandCenterItem({ id: "open-workspace", title: "Be concise: this workspace", icon: "IterationCw", context: "workspace",
    keywords: ["concise", "rules", "stats", "hooks"], onSelect({ openPanel }) { openPanel("workspace"); } });
  return contributeComposer(client);
}
