import { type PluginSidebarItemProps, useRpc } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { snapshot } from "../shared/contracts";
import { attentionTotal } from "./composer";

export const SCREEN_ID = "main";

export function SidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const fetchSnapshot = useRpc(snapshot);
  const summary = useQuery({ queryKey: ["concise", "summary"], queryFn: () => fetchSnapshot({ summary: true }), refetchInterval: 10_000, retry: 1 });
  const attention = summary.data?.connected ? attentionTotal(summary.data.stats.decisions) : 0;
  return <SidebarRow icon="IterationCw" active={currentScreen?.screenId === SCREEN_ID} onPress={() => openScreen({ screenId: SCREEN_ID })}
    trailing={attention > 0 ? <Text accessibilityLabel={`${attention} rejected or flagged`}
      style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums"] }}>{attention}</Text> : undefined} />;
}
