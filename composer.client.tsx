import { type PluginClientContext, type PluginComposerPillProps, useAgent, useRpc, useWorkspace } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, useWindowDimensions, View } from "react-native";
import { readConfiguration, snapshot, writeConfiguration } from "./contracts.shared";
import { enforcementUpdate } from "./enforcement.shared";
import { Button, decisionColor, Label, Row } from "./ui.client";

type Controller = { open?: () => void; details: () => void };

function ConcisePill({ theme, layout, workspaceId, agentId, controller }: PluginComposerPillProps & { controller: Controller }) {
  const cwd = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const provider = useAgent(agentId, (agent) => agent.provider) ?? "";
  const fetchSnapshot = useRpc(snapshot);
  const read = useRpc(readConfiguration);
  const write = useRpc(writeConfiguration);
  const cache = useQueryClient();
  const anchor = useRef<View>(null);
  const screen = useWindowDimensions();
  const [position, setPosition] = useState({ x: 12, y: 12 });
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const activity = useQuery({ queryKey: ["concise", "snapshot", cwd], queryFn: () => fetchSnapshot({ cwd: cwd! }), enabled: Boolean(cwd), refetchInterval: 3000, retry: 1 });
  const config = useQuery({ queryKey: ["concise", "configuration", cwd], queryFn: () => read({ cwd: cwd! }), enabled: Boolean(cwd), refetchInterval: 3000, retry: 1 });
  const bypassed = config.data?.effective.softFail === true;
  const failed = activity.isError || config.isError;
  const latest = activity.data?.events[0];
  const ready = activity.data?.connected && Boolean(config.data) && !failed;
  const color = failed ? theme.colors.statusDanger : bypassed ? theme.colors.statusWarning : ready ? theme.colors.statusSuccess : theme.colors.foregroundMuted;
  const label = failed ? "unavailable" : !ready ? "connecting" : bypassed ? "bypassed" : latest?.decision ?? "enabled";
  const mutation = useMutation({ mutationFn: async (enabled: boolean) => {
    if (!cwd || !config.data) throw new Error("Workspace configuration is unavailable.");
    return write({ cwd, ...enforcementUpdate(config.data, enabled, provider) });
  }, onSuccess(data, enabled) {
    cache.setQueryData(["concise", "configuration", cwd], data);
    void cache.invalidateQueries({ queryKey: ["concise", "configuration"] });
    setNotice(data.effective.softFail === !enabled ? (enabled ? "Workspace enforcement enabled." : "Workspace enforcement bypassed.") : "Saved. A daemon environment override controls enforcement.");
  } });
  useEffect(() => {
    controller.open = () => {
      setOpen(true);
      anchor.current?.measureInWindow((x, y) => setPosition({ x, y }));
    };
    return () => { controller.open = undefined; };
  }, [controller]);
  const width = Math.min(360, screen.width - 24);
  const height = Math.min(410, screen.height - 24);
  return <>
    <View ref={anchor} collapsable={false} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Icon name="ListFilter" size={14} color={color} />
      <Text numberOfLines={1} style={{ color, fontSize: 12, flexShrink: 1 }}>Concise · {label}</Text>
    </View>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close concise preview" onPress={() => setOpen(false)} style={{ position: "absolute", inset: 0 }} />
        <View accessibilityViewIsModal onAccessibilityEscape={() => setOpen(false)} style={{ position: "absolute",
          left: Math.max(12, Math.min(position.x, screen.width - width - 12)), top: Math.max(12, Math.min(position.y - height - 10, screen.height - height - 12)),
          width, maxHeight: height, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1,
          boxShadow: `0 8px 32px ${theme.colors.border}`, overflow: "hidden" }}>
          <ScrollView contentContainerStyle={{ padding: layout.compact ? 14 : 18, gap: 14 }}>
            <Row><View style={{ flex: 1 }}><Label theme={theme} size={16}>Be concise</Label><Label theme={theme} muted size={11}>This workspace · {cwd?.split("/").filter(Boolean).pop()}</Label></View>
              <Button theme={theme} label="Close" onPress={() => setOpen(false)} /></Row>
            <Row><View style={{ flex: 1 }}><Label theme={theme}>Enforcement {bypassed ? "bypassed" : "enabled"}</Label></View>
              <Switch accessibilityLabel="Enable workspace enforcement" value={!bypassed} disabled={!ready || mutation.isPending}
                onValueChange={(enabled) => { setNotice(""); mutation.mutate(enabled); }} trackColor={{ false: theme.colors.border, true: theme.colors.accent }} thumbColor={theme.colors.accentForeground} />
            </Row>
            <Label theme={theme} muted size={11}>Turn off to allow flagged actions. Hooks and test-output filtering stay active. Agent environment overrides apply separately.</Label>
            {activity.data && <Label theme={theme} muted>{activity.data.stats.total} calls · {activity.data.stats.interventions} interventions · {Math.round(activity.data.stats.averageMs)} ms avg.</Label>}
            {(activity.error || config.error || mutation.error) && <Label theme={theme}>{activity.error?.message ?? config.error?.message ?? mutation.error?.message}</Label>}
            {activity.data?.message && <Label theme={theme}>{activity.data.message}</Label>}
            {!!notice && <Label theme={theme}>{notice}</Label>}
            {latest && <View style={{ borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 10, gap: 5 }}>
              <Text style={{ color: decisionColor(theme, latest.decision), fontSize: 12 }}>{latest.decision} · {latest.hook}</Text>
              <Text numberOfLines={2} style={{ color: theme.colors.foreground, fontSize: 12 }}>{latest.target || latest.tool}</Text>
              {!!latest.summary && <Text numberOfLines={2} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{latest.summary}</Text>}
            </View>}
            {!latest && ready && <Label theme={theme} muted>Waiting for workspace activity.</Label>}
            <Button theme={theme} label="Open activity & configuration" onPress={() => { setOpen(false); controller.details(); }} />
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
