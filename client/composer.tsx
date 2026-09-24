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
import { Pressable, Text, View } from "react-native";
import { readConfiguration, snapshot, writeConfiguration } from "../shared/contracts";
import { enforcementUpdate } from "../shared/enforcement";
import { BrandIcon } from "./brand";
import { decisionColor, Label, ToggleIndicator } from "./ui";

const PILL_ID = "concise";
const PILL_TITLE = "Be concise: quick preview and enforcement";
const POLL_MS = 3000;
const decisionGroups = [
  { label: "allowed", names: ["allow"], icon: "Check", decision: "allow" },
  { label: "rejected", names: ["deny", "block"], icon: "X", decision: "deny" },
  { label: "flagged", names: ["ask", "flag"], icon: "TriangleAlert", decision: "flag" },
  { label: "rewritten", names: ["rewrite"], icon: "Pencil", decision: "rewrite" },
  { label: "bypassed", names: ["bypass"], icon: "SkipForward", decision: "bypass" },
  { label: "errors", names: ["error"], icon: "CircleAlert", decision: "error" },
];

/** Renders the brand mark tinted to the host's assigned pill color; the label carries live status. */
function ConciseIcon({ theme, size, color }: PluginButtonIconProps) {
  return <BrandIcon theme={theme} size={size} monochrome color={color} />;
}

/** Short live status for the pill label, e.g. "Enabled · 3 flagged". Mirrors the poll loop's own copy in attach(). */
function statusLabel(connected: boolean, bypassed: boolean, flagged: number): string {
  const base = !connected ? "Connecting" : bypassed ? "Bypassed" : "Enabled";
  return flagged > 0 ? `${base} · ${flagged} flagged` : base;
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
  const mutation = useMutation({ mutationFn: async (enabled: boolean) => {
    if (!cwd || !config.data) throw new Error("Workspace configuration is unavailable.");
    return write({ cwd, ...enforcementUpdate(config.data, enabled, provider) });
  }, onSuccess(data, enabled) {
    cache.setQueryData(["concise", "configuration", cwd], data);
    void cache.invalidateQueries({ queryKey: ["concise", "configuration"] });
    setNotice(data.effective.softFail === !enabled ? "" : "Saved. A daemon environment override controls enforcement.");
  } });
  const disabled = !ready || mutation.isPending;
  return <View style={{ gap: 12 }}>
    <Pressable accessibilityRole="switch" accessibilityLabel="Enable workspace enforcement" aria-checked={!bypassed} aria-disabled={disabled} accessibilityState={{ checked: !bypassed, disabled }}
      disabled={disabled} onPress={() => { setNotice(""); mutation.mutate(bypassed); }}
      style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <BrandIcon theme={theme} size={20} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>Be concise</Text>
        <Label theme={theme} muted size={12}>{bypassed ? "Flagged actions allowed. Filtering stays on." : "Enforcing rules in this workspace."}</Label>
      </View>
      <View style={{ opacity: disabled ? 0.5 : 1 }}><ToggleIndicator theme={theme} checked={!bypassed} /></View>
    </Pressable>
    <View style={{ gap: 8 }}>
      {ready && <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4 }}>
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
  type Poll = { registrations: Set<PluginButtonRegistration>; label: string; timer: ReturnType<typeof setInterval>; pending: boolean };
  const polls = new Map<string, Poll>();
  const pills = new Map<string, Pill>();
  const observed = new Set<string>();
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
        title: PILL_TITLE, label: polls.get(workspaceId)?.label ?? "Connecting", icon: ConciseIcon,
        behavior: { kind: "popover", Content: (props) => <ConciseContent {...props} onOpenDetails={() => { props.close(); client.openPanel("workspace", { workspaceId }); }} /> },
      },
    });
    pills.set(agentId, { workspaceId, registration });
    const existing = polls.get(workspaceId);
    if (existing) { existing.registrations.add(registration); return; }
    const workspace = client.paseo.workspaces.ref(workspaceId);
    const timer = setInterval(() => void refresh(), POLL_MS);
    const poll: Poll = { registrations: new Set([registration]), label: "Connecting", timer, pending: false };
    polls.set(workspaceId, poll);
    const live = () => !disposed && polls.get(workspaceId) === poll;
    function update(label: string) {
      if (!live()) return;
      poll.label = label;
      for (const item of poll.registrations) item.update({ label });
    }
    async function refresh() {
      if (!live() || poll.pending) return;
      poll.pending = true;
      try {
        const cwd = workspace.directory;
        if (!cwd) { update("Connecting"); return; }
        const [snap, config] = await Promise.all([client.rpc(snapshot, { cwd }), client.rpc(readConfiguration, { cwd })]);
        const bypassed = config.effective.softFail === true;
        const flagged = snap.stats.decisions.reduce((sum, item) => sum + (["ask", "flag"].includes(item.name) ? item.count : 0), 0);
        update(statusLabel(snap.connected, bypassed, flagged));
      } catch {
        update("Unavailable");
      } finally {
        poll.pending = false;
      }
    }
    void refresh();
  }
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") { observed.add(update.agentId); detach(update.agentId); }
    if (update.kind === "upsert") { observed.add(update.agent.id); attach(update.agent); }
  });
  void client.paseo.agents.list().then(({ entries }) => {
    if (!disposed) for (const { agent } of entries) if (!observed.has(agent.id)) attach(agent);
  }).catch((error: unknown) => { if (!disposed) console.error("Unable to load concise composer badges", error); });
  return () => { disposed = true; unsubscribe(); for (const id of [...pills.keys()]) detach(id); observed.clear(); };
}
