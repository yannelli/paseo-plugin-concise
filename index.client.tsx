import type { PluginClientContext } from "@getpaseo/plugin/client";
import { MainScreen, WorkspacePanel } from "./client/main";
import { contributeComposer } from "./client/composer";
import { SCREEN_ID, SidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: SCREEN_ID, title: "Be concise", Component: MainScreen });
  client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Be concise", Component: SidebarItem });
  client.addWorkspacePanel({ id: "workspace", title: "Be concise", icon: "IterationCw", locations: ["workspace", "explorer"], Component: WorkspacePanel });
  client.addCommandCenterItem({ id: "open", title: "Be concise: activity and configuration", icon: "IterationCw", context: "global",
    keywords: ["concise", "rules", "stats", "hooks"], onSelect({ openScreen }) { openScreen({ screenId: SCREEN_ID }); } });
  client.addCommandCenterItem({ id: "open-workspace", title: "Be concise: this workspace", icon: "IterationCw", context: "workspace",
    keywords: ["concise", "rules", "stats", "hooks"], onSelect({ openPanel }) { openPanel("workspace"); } });
  return contributeComposer(client);
}
