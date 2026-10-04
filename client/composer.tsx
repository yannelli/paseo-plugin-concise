import type { PluginTheme } from "@getpaseo/plugin";
import {
  type PluginButtonContentProps,
  type PluginButtonIconProps,
  type PluginButtonRegistration,
  type PluginClientContext,
  useAgent,
  useRpc,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { readConfiguration, snapshot, writeConfiguration } from "../shared/contracts";
import { enforcementUpdate } from "../shared/enforcement";
import { BrandIcon } from "./brand";
import { Label, ToggleIndicator } from "./ui";

const PILL_ID = "concise";
const POLL_MS = 3000;
const decisionGroups = [
  { label: "allowed", names: ["allow"], decision: "allow" },
  { label: "rejected", names: ["deny", "block"], decision: "deny" },
  { label: "flagged", names: ["ask", "flag"], decision: "flag" },
  { label: "rewritten", names: ["rewrite"], decision: "rewrite" },
  { label: "bypassed", names: ["bypass"], decision: "bypass" },
  { label: "errors", names: ["error"], decision: "error" },
];
const CHART_HEIGHT = 40;

function attentionColor(theme: PluginTheme, decision: string) {
  if (["deny", "block", "error"].includes(decision)) return theme.colors.statusDanger;
  if (["ask", "flag"].includes(decision)) return theme.colors.statusWarning;
  return null;
}

const stackOrder = (decision: string) => ["deny", "block", "error"].includes(decision) ? 2 : ["ask", "flag"].includes(decision) ? 1 : 0;

function Swatch({ theme, decision, style }: { theme: PluginTheme; decision: string; style: ViewStyle }) {
  const color = attentionColor(theme, decision);
  return <View style={[style, { backgroundColor: color ?? theme.colors.foregroundMuted, opacity: color ? 1 : 0.35 }]} />;
}

function decisionCounts(decisions: { name: string; count: number }[]) {
  return decisionGroups.map((group) => ({ ...group, count: decisions.reduce((sum, item) => sum + (group.names.includes(item.name) ? item.count : 0), 0) }))
    .filter((item, index) => index < 2 || item.count > 0);
}

function ConciseIcon({ theme, size, color }: PluginButtonIconProps) {
  return <BrandIcon theme={theme} size={size} monochrome color={color} />;
}

function pillStatus(state: "Connecting" | "Enabled" | "Bypassed" | "Unavailable", decisions: { name: string; count: number }[] = []) {
  const attention = decisionCounts(decisions).filter((item) => item.decision === "deny" || item.decision === "flag").reduce((sum, item) => sum + item.count, 0);
  const labels = { Connecting: "…", Enabled: String(attention), Bypassed: "Off", Unavailable: "!" };
  const summaries = { Connecting: "Connecting", Enabled: `${attention} rejected or flagged`, Bypassed: "Enforcement off", Unavailable: "Unavailable" };
  return { label: labels[state], icon: ConciseIcon, title: `Be concise · ${summaries[state]}` };
}

function ConciseContent(props: PluginButtonContentProps & { onOpenDetails: () => void }) {
  if (props.context !== "agent") return <Label theme={props.theme} muted>Be concise is only available for an agent.</Label>;
  return <ConciseAgentContent {...props} />;
}

function ConciseAgentContent({ theme, workspaceId, agentId, onOpenDetails }: Extract<PluginButtonContentProps, { context: "agent" }> & { onOpenDetails: () => void }) {
  const fetchSnapshot = useRpc(snapshot);
  const read = useRpc(readConfiguration);
  const write = useRpc(writeConfiguration);
  const cache = useQueryClient();
  const [notice, setNotice] = useState("");
  const cwd = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const provider = useAgent(agentId, (agent) => agent.provider) ?? "";
  const activity = useQuery({ queryKey: ["concise", "snapshot", cwd], queryFn: () => fetchSnapshot({ cwd: cwd! }), enabled: Boolean(cwd), refetchInterval: 3000, retry: 1 });
  const config = useQuery({ queryKey: ["concise", "configuration", cwd], queryFn: () => read({ cwd: cwd! }), enabled: Boolean(cwd), refetchInterval: 3000, retry: 1 });
  const bypassed = config.data?.effective.softFail === true;
  const failed = activity.isError || config.isError;
  const ready = activity.data?.connected && Boolean(config.data) && !failed;
  const counts = decisionCounts(activity.data?.stats.decisions ?? []);
  const minutes = (activity.data?.stats.minutes ?? []).map((minute) => {
    const start = Date.parse(minute.timestamp);
    const decisions = new Map<string, number>();
    for (const event of activity.data?.events ?? []) {
      const timestamp = Date.parse(event.timestamp);
      if (timestamp >= start && timestamp < start + 60_000) decisions.set(event.decision, (decisions.get(event.decision) ?? 0) + 1);
    }
    return { ...minute, decisions: [...decisions].sort(([a], [b]) => stackOrder(a) - stackOrder(b) || a.localeCompare(b)) };
  });
  const maximum = Math.max(1, ...minutes.map((minute) => minute.count));
  const mutation = useMutation({ mutationFn: async (enabled: boolean) => {
    if (!cwd || !config.data) throw new Error("Workspace configuration is unavailable.");
    return write({ cwd, ...enforcementUpdate(config.data, enabled, provider) });
  }, onSuccess(data, enabled) {
    cache.setQueryData(["concise", "configuration", cwd], data);
    void cache.invalidateQueries({ queryKey: ["concise", "configuration"] });
    setNotice(data.effective.softFail === !enabled ? "" : "Saved. A daemon environment override controls enforcement.");
  } });
  const disabled = !ready || mutation.isPending;
  const problem = mutation.error?.message ?? activity.data?.message ?? activity.error?.message ?? config.error?.message;
  const status = !ready ? problem ? "be-concise is unavailable." : "Connecting…" : bypassed ? "Flagged actions allowed. Filtering stays on." : "Enforcing rules in this workspace.";
  return <View style={{ gap: 12 }}>
    <Pressable accessibilityRole="switch" accessibilityLabel="Enable workspace enforcement" aria-checked={!bypassed} aria-disabled={disabled} accessibilityState={{ checked: !bypassed, disabled }}
      disabled={disabled} onPress={() => { setNotice(""); mutation.mutate(bypassed); }}
      style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <BrandIcon theme={theme} size={20} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>Be concise</Text>
        <Label theme={theme} muted size={12}>{status}</Label>
      </View>
      {ready && <View style={{ opacity: disabled ? 0.5 : 1 }}><ToggleIndicator theme={theme} checked={!bypassed} /></View>}
    </Pressable>
    <View style={{ gap: 8 }}>
      {ready && <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 18, rowGap: 8 }}>
        {counts.map((item) => <View key={item.label} style={{ gap: 2 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{item.count}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Swatch theme={theme} decision={item.decision} style={{ width: 6, height: 6, borderRadius: 3 }} />
            <Label theme={theme} muted size={11}>{item.label}</Label>
          </View>
        </View>)}
      </View>}
      {ready && <View style={{ gap: 4 }}>
        <View style={{ height: CHART_HEIGHT, flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
          {minutes.map((minute) => <View key={minute.timestamp} accessible accessibilityRole="image"
            accessibilityLabel={`${new Date(minute.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: ${minute.count} calls${minute.decisions.map(([decision, count]) => `, ${count} ${decision}`).join("")}`}
            style={{ flex: 1, height: CHART_HEIGHT, flexDirection: "column-reverse" }}>
            {minute.count === 0
              ? <View style={{ height: 2, borderRadius: 1, backgroundColor: theme.colors.border }} />
              : <View style={{ flexDirection: "column-reverse", borderTopLeftRadius: 2, borderTopRightRadius: 2, overflow: "hidden" }}>
                {minute.decisions.map(([decision, count]) => <Swatch key={decision} theme={theme} decision={decision} style={{ height: Math.max(2, CHART_HEIGHT * count / maximum) }} />)}
              </View>}
          </View>)}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Label theme={theme} muted size={10}>30 min ago</Label>
          <Label theme={theme} muted size={10}>Now</Label>
        </View>
        {!minutes.some((minute) => minute.count > 0) && <Label theme={theme} muted size={11}>No recent activity</Label>}
      </View>}
      {problem && <Label theme={theme} size={12}>{problem}</Label>}
      {!!notice && <Label theme={theme} size={12}>{notice}</Label>}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Open activity & configuration" onPress={onOpenDetails}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 34, paddingHorizontal: 10, borderRadius: 6,
        borderWidth: 1, borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface1 })}>
      <Icon name="SlidersHorizontal" size={14} color={theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foreground, fontSize: 13, flex: 1 }}>Activity & settings</Text>
      <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />
    </Pressable>
  </View>;
}

export function contributeComposer(client: PluginClientContext) {
  type Pill = { workspaceId: string; registration: PluginButtonRegistration };
  type Poll = { registrations: Set<PluginButtonRegistration>; status: ReturnType<typeof pillStatus>; timer: ReturnType<typeof setInterval>; pending: boolean };
  const polls = new Map<string, Poll>();
  const pills = new Map<string, Pill>();
  let disposed = false;
  function detach(id: string) {
    const pill = pills.get(id);
    if (!pill) return;
    const poll = polls.get(pill.workspaceId);
    poll?.registrations.delete(pill.registration);
    if (poll && poll.registrations.size === 0) {
      clearInterval(poll.timer);
      polls.delete(pill.workspaceId);
    }
    pill.registration.remove();
    pills.delete(id);
  }
  function attach(agent: { id: string; workspaceId?: string | null; provider: string; status: string; archivedAt?: string | null }) {
    if (disposed) return;
    const supported = /claude|codex/i.test(agent.provider);
    if (!agent.workspaceId || agent.status === "closed" || agent.archivedAt || !supported) return detach(agent.id);
    if (pills.get(agent.id)?.workspaceId === agent.workspaceId) return;
    detach(agent.id);
    const workspaceId = agent.workspaceId;
    const agentId = agent.id;
    const registration = client.addComposerPill({
      id: PILL_ID, workspaceId, agentId,
      button: {
        ...polls.get(workspaceId)?.status ?? pillStatus("Connecting"),
        behavior: { kind: "popover", Content: (props) => <ConciseContent {...props} onOpenDetails={() => { props.close(); client.openPanel("workspace", { workspaceId }); }} /> },
      },
    });
    pills.set(agentId, { workspaceId, registration });
    const existing = polls.get(workspaceId);
    if (existing) { existing.registrations.add(registration); return; }
    const workspace = client.paseo.workspaces.ref(workspaceId);
    const timer = setInterval(() => void refresh(), POLL_MS);
    const poll: Poll = { registrations: new Set([registration]), status: pillStatus("Connecting"), timer, pending: false };
    polls.set(workspaceId, poll);
    const live = () => !disposed && polls.get(workspaceId) === poll;
    function update(status: ReturnType<typeof pillStatus>) {
      if (!live()) return;
      poll.status = status;
      for (const item of poll.registrations) item.update(status);
    }
    async function refresh() {
      if (!live() || poll.pending) return;
      poll.pending = true;
      try {
        const cwd = workspace.directory ?? (await workspace.refresh())?.workspaceDirectory;
        if (!cwd) { update(pillStatus("Connecting")); return; }
        const [snap, config] = await Promise.all([client.rpc(snapshot, { cwd }), client.rpc(readConfiguration, { cwd })]);
        const bypassed = config.effective.softFail === true;
        update(pillStatus(!snap.connected ? "Connecting" : bypassed ? "Bypassed" : "Enabled", snap.stats.decisions));
      } catch {
        update(pillStatus("Unavailable"));
      } finally {
        poll.pending = false;
      }
    }
    void refresh();
  }
  const lifetime = new AbortController();
  let unsubscribe = () => {};
  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(({ subscription }) => {
    if (disposed) { void subscription.release(); return; }
    const stop = subscription.subscribe({
      snapshot({ entries }) {
        const current = new Set(entries.map(({ agent }) => agent.id));
        for (const id of [...pills.keys()]) if (!current.has(id)) detach(id);
        for (const { agent } of entries) attach(agent);
      },
      update(message) {
        if (message.type !== "agent_update") return;
        const update = message.payload;
        if (update.kind === "remove") detach(update.agentId);
        if (update.kind === "upsert") attach(update.agent);
      },
    });
    unsubscribe = () => { stop(); void subscription.release(); };
  }).catch((error: unknown) => { if (!disposed) console.error("Unable to load concise composer badges", error); });
  return () => { disposed = true; lifetime.abort(); unsubscribe(); for (const id of [...pills.keys()]) detach(id); };
}
