import { type PluginTheme, useRpc } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type ActivityEvent, type ActivityStats, eventDetail } from "./contracts.shared";
import { Button, Card, Chips, decisionColor, Field, Label, Row } from "./ui.client";

export function Activity({ theme, compact, events, stats, paused, onPause }: {
  theme: PluginTheme; compact: boolean; events: ActivityEvent[]; stats: ActivityStats; paused: boolean; onPause: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(60);
  const [breakdown, setBreakdown] = useState(false);
  const visible = useMemo(() => events.filter((event) =>
    (filter === "all" || (filter === "attention" ? ["deny", "ask", "block", "error"].includes(event.decision) : event.decision === filter)) &&
    `${event.tool} ${event.hook} ${event.target} ${event.summary} ${event.session} ${event.projectName}`.toLowerCase().includes(search.toLowerCase())
  ), [events, filter, search]);
  const maximum = Math.max(1, ...stats.minutes.map((minute) => minute.count));
  const metrics = [{ label: "Hook calls", value: stats.total.toLocaleString() }, { label: "Interventions", value: stats.interventions.toLocaleString() },
    { label: "Sessions", value: stats.sessions.toLocaleString() }, { label: "Avg. duration", value: `${Math.round(stats.averageMs)} ms` }];
  return <View style={{ gap: 22 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {metrics.map((metric) => <View key={metric.label} style={{ flexGrow: 1, flexBasis: compact ? "44%" : "22%", backgroundColor: theme.colors.surface1,
        borderWidth: 1, borderColor: theme.colors.border, padding: compact ? 14 : 20, borderRadius: 12, gap: 8 }}>
        <Label theme={theme} muted size={12}>{metric.label}</Label>
        <Text style={{ color: theme.colors.foreground, fontSize: compact ? 26 : 32, fontWeight: "500", letterSpacing: -0.6 }}>{metric.value}</Text>
      </View>)}
    </View>
    <Card theme={theme}>
      <Row><View style={{ flex: 1 }}><Label theme={theme}>Activity over the last 30 minutes</Label></View><Button theme={theme} label={breakdown ? "Hide stats" : "More stats"} onPress={() => setBreakdown(!breakdown)} /></Row>
      <View accessibilityLabel={stats.minutes.map((item) => `${new Date(item.timestamp).toLocaleTimeString()}: ${item.count}`).join(", ")}
        style={{ height: 54, flexDirection: "row", alignItems: "flex-end", gap: compact ? 3 : 5 }}>
        {stats.minutes.map((minute) => <View key={minute.timestamp} style={{ flex: 1, height: Math.max(3, 54 * minute.count / maximum), borderRadius: 3,
          backgroundColor: minute.count ? theme.colors.accent : theme.colors.border, opacity: minute.count ? 0.85 : 0.6 }} />)}
      </View>
      <Row><Label theme={theme} muted size={11}>30 min ago</Label><View style={{ flex: 1 }} /><Label theme={theme} muted size={11}>Now</Label></Row>
      {breakdown && <View style={{ flexDirection: compact ? "column" : "row", gap: 24 }}>
        {[{ title: "Decisions", items: stats.decisions }, { title: "Hooks", items: stats.hooks }].map((group) => <View key={group.title} style={{ flex: 1, gap: 8 }}>
          <Label theme={theme}>{group.title}</Label>
          {group.items.map((item) => <Row key={item.name}><View style={{ flex: 1 }}><Label theme={theme} muted>{item.name}</Label></View><Label theme={theme}>{item.count}</Label></Row>)}
        </View>)}
      </View>}
      <Label theme={theme} muted size={11}>Stats cover retained events. Interventions count deny, ask, and block decisions.</Label>
    </Card>
    <View style={{ gap: 12 }}>
      <Row><View style={{ flex: 1 }}><Label theme={theme} size={18}>Recent activity</Label></View>
        <Button theme={theme} label={paused ? "Resume live" : "Pause feed"} onPress={onPause} />
      </Row>
      <Chips theme={theme} value={filter} onChange={(value) => { setFilter(value); setLimit(60); }} items={[
        { value: "all", label: "All decisions" }, { value: "attention", label: "Needs attention" }, { value: "allow", label: "Allowed" },
        { value: "flag", label: "Flagged" }, { value: "rewrite", label: "Rewritten" }, { value: "bypass", label: "Bypassed" },
      ]} />
      <Field theme={theme} label="Search activity" value={search} onChange={(value) => { setSearch(value); setLimit(60); }} placeholder="Tool, file, session, or reason" />
      <Label theme={theme} muted size={11}>{visible.length} matching events{paused ? " · Display paused" : ""}</Label>
      <View style={{ borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12, overflow: "hidden" }}>
        {visible.length ? visible.slice(0, limit).map((event) => <EventRow key={event.id} event={event} theme={theme} compact={compact} />) :
          <View style={{ padding: 28, gap: 6 }}><Label theme={theme} size={16}>{events.length ? "No matching events" : "Waiting for the next hook"}</Label>
            <Label theme={theme} muted>{events.length ? "Try another decision or search term." : "Use Claude or Codex with be-concise enabled. Saved hook decisions will appear here."}</Label></View>}
      </View>
      {visible.length > limit && <Button theme={theme} label="Show more events" onPress={() => setLimit(limit + 60)} />}
    </View>
  </View>;
}

function EventRow({ event, theme, compact }: { event: ActivityEvent; theme: PluginTheme; compact: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const fetchDetail = useRpc(eventDetail);
  const detail = useQuery({ queryKey: ["concise", "event", event.id], queryFn: () => fetchDetail({ id: event.id }), enabled: expanded && showJson, retry: false, staleTime: Infinity });
  const tint = decisionColor(theme, event.decision);
  return <View style={{ borderBottomWidth: 1, borderColor: theme.colors.border, backgroundColor: expanded ? theme.colors.surface1 : theme.colors.surface0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${event.decision}: ${event.tool || event.hook}. ${event.target}. Show details`}
      accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ padding: compact ? 12 : 16, gap: 7 }}>
      <Row>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tint }} />
        <Text style={{ color: tint, fontSize: 11, fontWeight: "600", minWidth: 48 }}>{event.decision}</Text>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "500", flex: 1 }}>{event.tool || event.hook}</Text>
        <Label theme={theme} muted size={11}>{new Date(event.timestamp).toLocaleTimeString()}</Label>
      </Row>
      <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 12, paddingLeft: 14 }}>{event.target || event.summary || event.hook}</Text>
      {expanded && <Label theme={theme} muted size={11}>{event.projectName} · {event.hook} · {event.durationMs} ms</Label>}
    </Pressable>
    {expanded && <View style={{ paddingHorizontal: compact ? 12 : 16, paddingBottom: 16, gap: 12 }}>
      {!!event.summary && <Label theme={theme}>{event.summary}</Label>}
      {!!event.session && <Label theme={theme} muted size={11}>Session {event.session}</Label>}
      <Row><Button theme={theme} label={showJson ? "Hide request & response" : "View request & response"} onPress={() => setShowJson(!showJson)} /></Row>
      {showJson && detail.isPending && <Label theme={theme} muted>Loading event…</Label>}
      {showJson && detail.error && <Label theme={theme}>{detail.error.message}</Label>}
      {showJson && detail.data && <Text selectable style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface0, padding: 12, borderRadius: 8, fontFamily: "monospace", fontSize: 11, lineHeight: 17 }}>{detail.data.json}</Text>}
    </View>}
  </View>;
}
