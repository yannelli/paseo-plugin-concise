import { type PluginTheme, useRpc } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { type ActivityEvent, type ActivityStats, eventDetail } from "./contracts.shared";
import { Button, Card, decisionColor, Label, Row } from "./ui.client";

const filters = [
  { value: "all", label: "All decisions" }, { value: "attention", label: "Needs attention" }, { value: "allow", label: "Allowed" },
  { value: "flag", label: "Flagged" }, { value: "rewrite", label: "Rewritten" }, { value: "bypass", label: "Bypassed" },
];

export function Activity({ theme, compact, events, stats, paused, onPause }: {
  theme: PluginTheme; compact: boolean; events: ActivityEvent[]; stats: ActivityStats; paused: boolean; onPause: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(60);
  const [statsOpen, setStatsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const visible = useMemo(() => events.filter((event) =>
    (filter === "all" || (filter === "attention" ? ["deny", "ask", "block", "error"].includes(event.decision) : event.decision === filter)) &&
    `${event.tool} ${event.hook} ${event.target} ${event.summary} ${event.session} ${event.projectName}`.toLowerCase().includes(search.toLowerCase())
  ), [events, filter, search]);
  const maximum = Math.max(1, ...stats.minutes.map((minute) => minute.count));
  const metrics = [{ label: "Hook calls", value: stats.total.toLocaleString() }, { label: "Interventions", value: stats.interventions.toLocaleString() },
    { label: "Sessions", value: stats.sessions.toLocaleString() }, { label: "Avg. duration", value: `${Math.round(stats.averageMs)} ms` }];
  return <View style={{ gap: 14, minWidth: 0 }}>
    <Card theme={theme}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {metrics.map((metric) => <View key={metric.label} style={{ flexGrow: 1, flexBasis: compact ? "44%" : "22%", minWidth: 0, gap: 2 }}>
          <Label theme={theme} muted size={11}>{metric.label}</Label>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: theme.colors.foreground, fontSize: 20, fontWeight: "500", letterSpacing: -0.4 }}>{metric.value}</Text>
        </View>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Activity stats" accessibilityState={{ expanded: statsOpen }} onPress={() => setStatsOpen(!statsOpen)}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 8, borderTopWidth: 1, borderColor: theme.colors.border }}>
        <Icon name={statsOpen ? "ChevronDown" : "ChevronRight"} size={13} color={theme.colors.foregroundMuted} />
        <Label theme={theme} muted size={12}>Activity stats</Label>
      </Pressable>
      {statsOpen && <View style={{ gap: 10, minWidth: 0 }}>
        <Label theme={theme} muted size={11}>Last 30 minutes</Label>
        <View accessibilityLabel={stats.minutes.map((item) => `${new Date(item.timestamp).toLocaleTimeString()}: ${item.count}`).join(", ")}
          style={{ height: 40, flexDirection: "row", alignItems: "flex-end", gap: compact ? 2 : 4 }}>
          {stats.minutes.map((minute) => <View key={minute.timestamp} style={{ flex: 1, height: Math.max(2, 40 * minute.count / maximum), borderRadius: 2,
            backgroundColor: minute.count ? theme.colors.accent : theme.colors.border, opacity: minute.count ? 0.85 : 0.6 }} />)}
        </View>
        <Row><Label theme={theme} muted size={11}>30 min ago</Label><View style={{ flex: 1 }} /><Label theme={theme} muted size={11}>Now</Label></Row>
        <View style={{ flexDirection: compact ? "column" : "row", gap: 12 }}>
          {[{ title: "Decisions", items: stats.decisions }, { title: "Hooks", items: stats.hooks }].map((group) => <View key={group.title} style={{ flex: compact ? undefined : 1, minWidth: 0, gap: 5 }}>
            <Label theme={theme} size={12}>{group.title}</Label>
            {group.items.map((item) => <Row key={item.name}><View style={{ flex: 1, minWidth: 0 }}><Label theme={theme} muted size={12}>{item.name}</Label></View><Label theme={theme} size={12}>{item.count}</Label></Row>)}
          </View>)}
        </View>
      </View>}
    </Card>
    <View style={{ gap: 8, minWidth: 0 }}>
      <Row><View style={{ flex: 1, minWidth: 0 }}><Label theme={theme} size={14}>Recent activity</Label></View>
        <Button theme={theme} label={paused ? "Resume" : "Pause"} onPress={onPause} />
      </Row>
      <View style={{ gap: 4 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Filter activity" accessibilityState={{ expanded: filtersOpen }} onPress={() => setFiltersOpen(!filtersOpen)}
          style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, minHeight: 30, paddingHorizontal: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6 }}>
          <Icon name="ListFilter" size={13} color={theme.colors.foregroundMuted} />
          <Label theme={theme} size={12}>{filters.find((item) => item.value === filter)?.label}</Label>
          <Icon name={filtersOpen ? "ChevronUp" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
        </Pressable>
        {filtersOpen && <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, padding: 4, backgroundColor: theme.colors.surface1 }}>
          {filters.map((item) => <Pressable key={item.value} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: filter === item.value }}
            onPress={() => { setFilter(item.value); setLimit(60); setFiltersOpen(false); }}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, minHeight: 30, borderRadius: 4,
              backgroundColor: pressed || filter === item.value ? theme.colors.surface2 : "transparent" })}>
            <View style={{ width: 14 }}>{filter === item.value && <Icon name="Check" size={14} color={theme.colors.foreground} />}</View>
            <Label theme={theme} size={12}>{item.label}</Label>
          </Pressable>)}
        </View>}
      </View>
      <TextInput accessibilityLabel="Search activity" value={search} onChangeText={(value) => { setSearch(value); setLimit(60); }}
        autoCapitalize="none" autoCorrect={false} placeholder="Search tool, file, session, or reason" placeholderTextColor={theme.colors.foregroundMuted}
        style={{ minWidth: 0, minHeight: 32, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6,
          backgroundColor: theme.colors.surface0, color: theme.colors.foreground, fontSize: 12 }} />
      <Label theme={theme} muted size={11}>{visible.length} matching events{paused ? " · Display paused" : ""}</Label>
      <View style={{ borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, overflow: "hidden", minWidth: 0 }}>
        {visible.length ? visible.slice(0, limit).map((event) => <EventRow key={event.id} event={event} theme={theme} compact={compact} />) :
          <View style={{ padding: 12, gap: 4 }}><Label theme={theme}>{events.length ? "No matching events" : "Waiting for the next hook"}</Label>
            <Label theme={theme} muted size={12}>{events.length ? "Try another decision or search term." : "Use Claude or Codex with be-concise enabled to see saved hook decisions."}</Label></View>}
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
  return <View style={{ minWidth: 0, borderBottomWidth: 1, borderColor: theme.colors.border, backgroundColor: expanded ? theme.colors.surface1 : theme.colors.surface0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${event.decision}: ${event.tool || event.hook}. ${event.target}. Show details`}
      accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ padding: compact ? 8 : 10, gap: 4, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tint }} />
        <Text style={{ color: tint, fontSize: 11, fontWeight: "600" }}>{event.decision}</Text>
        <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500", flex: 1, minWidth: 0 }}>{event.tool || event.hook}</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{new Date(event.timestamp).toLocaleTimeString()}</Text>
      </View>
      <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11, paddingLeft: 12 }}>{event.target || event.summary || event.hook}</Text>
      {expanded && <Label theme={theme} muted size={11}>{event.projectName} · {event.hook} · {event.durationMs} ms</Label>}
    </Pressable>
    {expanded && <View style={{ paddingHorizontal: compact ? 8 : 10, paddingBottom: 10, gap: 8, minWidth: 0 }}>
      {!!event.summary && <Label theme={theme}>{event.summary}</Label>}
      {!!event.session && <Label theme={theme} muted size={11}>Session {event.session}</Label>}
      <Row><Button theme={theme} label={showJson ? "Hide request & response" : "Request & response"} onPress={() => setShowJson(!showJson)} /></Row>
      {showJson && detail.isPending && <Label theme={theme} muted>Loading event…</Label>}
      {showJson && detail.error && <Label theme={theme}>{detail.error.message}</Label>}
      {showJson && detail.data && <Text selectable style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface0, padding: 8, borderRadius: 6, fontFamily: "monospace", fontSize: 11, lineHeight: 16, minWidth: 0 }}>{detail.data.json}</Text>}
    </View>}
  </View>;
}
