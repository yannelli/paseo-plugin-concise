import { type PluginClientContext, type PluginComposerPillProps, useAgent, useRpc, useWorkspace } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { readConfiguration, snapshot, writeConfiguration } from "./contracts.shared";
import { enforcementUpdate } from "./enforcement.shared";
import { popoverLayout } from "./layout.shared";
import { BrandIcon } from "./brand.client";
import { decisionColor, Label, ToggleIndicator } from "./ui.client";

type Controller = { open?: () => void; details: () => void };
const decisionGroups = [
  { label: "allowed", names: ["allow"], icon: "Check", decision: "allow" },
  { label: "rejected", names: ["deny", "block"], icon: "X", decision: "deny" },
  { label: "flagged", names: ["ask", "flag"], icon: "TriangleAlert", decision: "flag" },
  { label: "rewritten", names: ["rewrite"], icon: "Pencil", decision: "rewrite" },
  { label: "bypassed", names: ["bypass"], icon: "SkipForward", decision: "bypass" },
  { label: "errors", names: ["error"], icon: "CircleAlert", decision: "error" },
];

function ConcisePill({ theme, workspaceId, agentId, controller }: PluginComposerPillProps & { controller: Controller }) {
  const cwd = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const provider = useAgent(agentId, (agent) => agent.provider) ?? "";
  const fetchSnapshot = useRpc(snapshot);
  const read = useRpc(readConfiguration);
  const write = useRpc(writeConfiguration);
  const cache = useQueryClient();
  const anchor = useRef<View>(null);
  const screen = useWindowDimensions();
  const [position, setPosition] = useState({ x: 8, y: 8, width: 0, height: 0 });
  const [contentHeight, setContentHeight] = useState(0);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [hovered, setHovered] = useState("");
  const activity = useQuery({ queryKey: ["concise", "snapshot", cwd], queryFn: () => fetchSnapshot({ cwd: cwd! }), enabled: Boolean(cwd), refetchInterval: 3000, retry: 1 });
  const config = useQuery({ queryKey: ["concise", "configuration", cwd], queryFn: () => read({ cwd: cwd! }), enabled: Boolean(cwd), refetchInterval: 3000, retry: 1 });
  const bypassed = config.data?.effective.softFail === true;
  const failed = activity.isError || config.isError;
  const ready = activity.data?.connected && Boolean(config.data) && !failed;
  const color = failed ? theme.colors.statusDanger : ready && !bypassed ? theme.colors.foreground : theme.colors.foregroundMuted;
  const label = failed ? "Unavailable" : !ready ? "Connecting" : bypassed ? "Bypassed" : "Enabled";
  const counts = decisionGroups.map((group) => ({ ...group, count: (activity.data?.stats.decisions ?? []).reduce((sum, item) => sum + (group.names.includes(item.name) ? item.count : 0), 0) }));
  const minutes = (activity.data?.stats.minutes ?? []).map((minute) => {
    const start = Date.parse(minute.timestamp);
    const decisions = new Map<string, number>();
    for (const event of activity.data?.events ?? []) {
      const timestamp = Date.parse(event.timestamp);
      if (timestamp >= start && timestamp < start + 60_000) decisions.set(event.decision, (decisions.get(event.decision) ?? 0) + 1);
    }
    return { ...minute, decisions: [...decisions].sort(([a], [b]) => a.localeCompare(b)) };
  });
  const maximum = Math.max(1, ...minutes.map((minute) => minute.count));
  const otherCount = counts.slice(2).reduce((sum, item) => sum + item.count, 0);
  const badgeCounts = [...counts.slice(0, 2), ...(otherCount ? [{ label: "other decisions", count: otherCount, icon: "Ellipsis", decision: "flag" }] : [])];
  const mutation = useMutation({ mutationFn: async (enabled: boolean) => {
    if (!cwd || !config.data) throw new Error("Workspace configuration is unavailable.");
    return write({ cwd, ...enforcementUpdate(config.data, enabled, provider) });
  }, onSuccess(data, enabled) {
    cache.setQueryData(["concise", "configuration", cwd], data);
    void cache.invalidateQueries({ queryKey: ["concise", "configuration"] });
    setNotice(data.effective.softFail === !enabled ? "" : "Saved. A daemon environment override controls enforcement.");
  } });
  useEffect(() => {
    controller.open = () => {
      anchor.current?.measureInWindow((x, y, width, height) => {
        setPosition({ x: x - 12, y: y - 7, width: width + 24, height: height + 14 });
        setOpen(true);
      });
    };
    return () => { controller.open = undefined; };
  }, [controller]);
  useEffect(() => { setOpen(false); }, [screen.width, screen.height]);
  const menu = popoverLayout(position, screen, contentHeight);
  const disabled = !ready || mutation.isPending;
  const rowStyle = (id: string, pressed: boolean) => ({
    flexDirection: "row" as const, alignItems: "center" as const, gap: 10, minHeight: 36, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 5, backgroundColor: pressed || hovered === id ? theme.colors.surface2 : "transparent",
  });
  return <>
    <View ref={anchor} collapsable={false} style={{ flexDirection: "row", alignItems: "center", height: 20, gap: 6, maxWidth: Math.min(300, screen.width - 56) }}>
      <View accessibilityRole="text" accessibilityLabel={`Be concise ${label.toLowerCase()}`}><BrandIcon theme={theme} size={14} monochrome color={color} /></View>
      {ready && <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {badgeCounts.map((item) => <View key={item.label} accessibilityRole="text" accessibilityLabel={`${item.count} ${item.label}`}
          style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Icon name={item.icon} size={10} color={decisionColor(theme, item.decision)} />
          <Text style={{ color: decisionColor(theme, item.decision), fontSize: 11, fontWeight: "normal", fontVariant: ["tabular-nums"] }}>{item.count}</Text>
        </View>)}
      </View>}
    </View>
    <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close concise preview" onPress={(event) => { event.stopPropagation(); setOpen(false); }} style={{ position: "absolute", inset: 0 }} />
        <View accessibilityViewIsModal accessibilityLabel="Be concise quick controls" onAccessibilityEscape={() => setOpen(false)} style={{ position: "absolute", ...menu,
          opacity: contentHeight ? 1 : 0, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1,
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)", overflow: "hidden" }}>
          <ScrollView style={{ maxHeight: menu.maxHeight }} onContentSizeChange={(_, height) => setContentHeight(height + 2)} contentContainerStyle={{ padding: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 7 }}>
              <BrandIcon theme={theme} size={16} />
              <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500", flex: 1 }}>Be concise</Text>
              <Pressable accessibilityRole="switch" accessibilityLabel="Enable workspace enforcement" aria-checked={!bypassed} aria-disabled={disabled} accessibilityState={{ checked: !bypassed, disabled }}
                disabled={disabled} onPress={(event) => { event.stopPropagation(); setNotice(""); mutation.mutate(bypassed); }}
                style={{ opacity: disabled ? 0.5 : 1 }}>
                <ToggleIndicator theme={theme} checked={!bypassed} />
              </Pressable>
            </View>
            {bypassed && <View style={{ paddingHorizontal: 10, paddingBottom: 7 }}><Label theme={theme} muted size={11}>Flagged actions allowed. Filtering stays on.</Label></View>}
            <View style={{ marginVertical: 4, borderTopWidth: 1, borderColor: theme.colors.border }} />
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, gap: 5 }}>
              {ready && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {counts.filter((item, index) => index < 2 || item.count > 0).map((item) => <View key={item.label} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Icon name={item.icon} size={11} color={decisionColor(theme, item.decision)} />
                  <Label theme={theme} muted size={11}>{item.count} {item.label}</Label>
                </View>)}
              </View>}
              {ready && <View style={{ gap: 3 }}>
                <View style={{ height: 48, flexDirection: "row", alignItems: "flex-end", gap: 2, borderBottomWidth: 1, borderColor: theme.colors.border }}>
                  {minutes.map((minute) => <View key={minute.timestamp} accessible accessibilityRole="image"
                    accessibilityLabel={`${new Date(minute.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: ${minute.count} calls${minute.decisions.map(([decision, count]) => `, ${count} ${decision}`).join("")}`}
                    style={{ flex: 1, height: 46, flexDirection: "column-reverse" }}>
                    {minute.decisions.map(([decision, count]) => <View key={decision} style={{ height: 46 * count / maximum, backgroundColor: decisionColor(theme, decision) }} />)}
                  </View>)}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Label theme={theme} muted size={10}>30 min ago</Label>
                  <Label theme={theme} muted size={10}>Now</Label>
                </View>
                {!minutes.some((minute) => minute.count > 0) && <Label theme={theme} muted size={11}>No recent activity</Label>}
              </View>}
              {(activity.error || config.error || mutation.error) && <Label theme={theme} size={12}>{activity.error?.message ?? config.error?.message ?? mutation.error?.message}</Label>}
              {activity.data?.message && <Label theme={theme} size={12}>{activity.data.message}</Label>}
              {!!notice && <Label theme={theme} size={12}>{notice}</Label>}
            </View>
            <View style={{ marginVertical: 4, borderTopWidth: 1, borderColor: theme.colors.border }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Open activity & configuration" onPress={(event) => { event.stopPropagation(); setOpen(false); controller.details(); }}
              onHoverIn={() => setHovered("details")} onHoverOut={() => setHovered("")}
              style={({ pressed }) => rowStyle("details", pressed)}>
              <Icon name="SlidersHorizontal" size={15} color={theme.colors.foregroundMuted} />
              <Text style={{ color: theme.colors.foreground, fontSize: 13, flex: 1 }}>Activity & settings</Text>
              <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

export function contributeComposer(client: PluginClientContext) {
  const pills = new Map<string, { workspaceId: string; remove: () => void }>();
  const observed = new Set<string>();
  let disposed = false;
  function detach(id: string) { pills.get(id)?.remove(); pills.delete(id); }
  function attach(agent: { id: string; workspaceId?: string | null; provider: string; status: string; archivedAt?: string | null }) {
    if (disposed) return;
    const supported = /claude|codex/i.test(agent.provider);
    if (!agent.workspaceId || agent.status === "closed" || agent.archivedAt || !supported) return detach(agent.id);
    if (pills.get(agent.id)?.workspaceId === agent.workspaceId) return;
    detach(agent.id);
    const workspaceId = agent.workspaceId;
    const controller: Controller = { details: () => client.openPanel("workspace", { workspaceId }) };
    const remove = client.addComposerPill({ id: "concise", title: "Be concise: quick preview and enforcement", workspaceId, agentId: agent.id,
      Component: (props) => <ConcisePill {...props} controller={controller} />, onPress() { controller.open?.(); } });
    pills.set(agent.id, { workspaceId, remove });
  }
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") { observed.add(update.agentId); detach(update.agentId); }
    if (update.kind === "upsert") { observed.add(update.agent.id); attach(update.agent); }
  });
  void client.paseo.agents.list().then(({ entries }) => {
    if (!disposed) for (const { agent } of entries) if (!observed.has(agent.id)) attach(agent);
  }).catch((error: unknown) => { if (!disposed) console.error("Unable to load concise composer badges", error); });
  return () => { disposed = true; unsubscribe(); for (const pill of pills.values()) pill.remove(); pills.clear(); observed.clear(); };
}
