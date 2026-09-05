import { type PluginSurfaceProps, type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { snapshot } from "./contracts.shared";
import { Activity } from "./activity.client";
import { BrandIcon } from "./brand.client";
import { ConfigurationEditor } from "./configuration.client";
import { Playground } from "./playground.client";
import { Button, Card, Chips, Label, Row } from "./ui.client";

type Props = Pick<PluginSurfaceProps, "theme" | "layout"> & { cwd?: string };

export function MainSurface(props: PluginSurfaceProps) {
  return <Dashboard {...props} />;
}

export function WorkspacePanel(props: PluginWorkspacePanelProps) {
  const directory = useWorkspace(props.workspaceId, (workspace) => workspace.directory);
  if (!directory) return <View style={{ padding: 20, backgroundColor: props.theme.colors.surface0 }}><Label theme={props.theme}>Loading workspace…</Label></View>;
  return <Dashboard key={directory} {...props} cwd={directory} />;
}

function Dashboard({ theme, layout, cwd }: Props) {
  const fetchSnapshot = useRpc(snapshot);
  const [selected, setSelected] = useState(cwd ?? "");
  const [tab, setTab] = useState("activity");
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  const [paused, setPaused] = useState<Awaited<ReturnType<typeof fetchSnapshot>> | null>(null);
  const compact = layout.compact || (width !== null && width < 560);
  const query = useQuery({ queryKey: ["concise", "snapshot", selected], queryFn: () => fetchSnapshot(selected ? { cwd: selected } : {}),
    refetchInterval: paused ? false : 2000, retry: 1 });
  const data = paused ?? query.data;
  const project = data?.projects.find((item) => item.cwd === selected);
  const name = selected ? project?.name ?? selected.split("/").filter(Boolean).pop() : "All projects";
  const choose = (value: string) => { setSelected(value); setPaused(null); setProjectsOpen(false); };

  return <ScrollView onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    style={{ flex: 1, minWidth: 0, backgroundColor: theme.colors.surface0 }}
    contentContainerStyle={{ padding: compact ? 10 : 16, gap: 14, width: "100%", maxWidth: 1040, alignSelf: "center" }}>
    <View style={{ gap: 10, minWidth: 0 }}>
      <Row>
        <BrandIcon theme={theme} size={26} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "600", letterSpacing: -0.3 }}>Be concise</Text>
        </View>
        <View accessibilityRole="text" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: query.isError ? theme.colors.statusDanger : paused ? theme.colors.statusWarning : data?.connected ? theme.colors.statusSuccess : theme.colors.foregroundMuted }} />
          <Label theme={theme} muted size={11}>{query.isError ? "Offline" : paused ? "Paused" : data?.connected ? "Live" : "Connecting"}</Label>
        </View>
      </Row>
      <View style={{ flexDirection: compact ? "column" : "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between", minWidth: 0 }}>
        <Chips theme={theme} value={tab} onChange={setTab} items={[{ value: "activity", label: "Activity" }, { value: "configuration", label: compact ? "Config" : "Configuration" }, { value: "playground", label: compact ? "Preview" : "Playground" }]} />
        {!cwd && <Button theme={theme} label={`${name} ${projectsOpen ? "−" : "+"}`} onPress={() => setProjectsOpen(!projectsOpen)} />}
        {cwd && <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11, minWidth: 0, flexShrink: 1, alignSelf: compact ? "flex-start" : "center" }}>{name}</Text>}
      </View>
      {projectsOpen && <Card theme={theme}>
        {[{ cwd: "", key: "all", name: "All projects" }, ...(data?.projects ?? [])].map((item) => <Pressable key={item.key}
          accessibilityRole="button" accessibilityLabel={`Select ${item.name}`} onPress={() => choose(item.cwd)}
          style={{ padding: 8, gap: 2, borderRadius: 6, minWidth: 0, backgroundColor: item.cwd === selected ? theme.colors.surface2 : theme.colors.surface1 }}>
          <Label theme={theme}>{item.name}</Label>
          {!!item.cwd && <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{item.cwd}</Text>}
        </Pressable>)}
      </Card>}
    </View>
    {query.isError && <Card theme={theme}><Label theme={theme}>Connection interrupted: {query.error.message}</Label><Button theme={theme} label="Reconnect" onPress={() => void query.refetch()} /></Card>}
    {!data && query.isPending && <Label theme={theme} muted>Reading be-concise activity…</Label>}
    {data && !data.connected && <Card theme={theme}>
      <Label theme={theme} size={18}>Connect be-concise</Label>
      <Label theme={theme} muted>{data.message}</Label>
      <Button theme={theme} label="Check again" onPress={() => void query.refetch()} />
    </Card>}
    {data?.connected && <>
      {tab === "activity" && <Activity key={selected} theme={theme} compact={compact} events={data.events} stats={data.stats}
        paused={Boolean(paused)} onPause={() => setPaused(paused ? null : data)} />}
      {tab !== "activity" && !selected && <Card theme={theme}>
        <Label theme={theme} size={18}>Choose a project</Label><Label theme={theme} muted>Configuration and previews use the selected project’s settings.</Label>
        <Button theme={theme} label="Choose project" onPress={() => setProjectsOpen(true)} />
      </Card>}
      {tab === "configuration" && selected && <ConfigurationEditor key={selected} cwd={selected} theme={theme} compact={compact} />}
      {tab === "playground" && selected && <Playground key={selected} cwd={selected} theme={theme} compact={compact} />}
      <View style={{ borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 10, gap: 3 }}>
        <Label theme={theme} muted size={11}>be-concise {data.version} · Updated {new Date(data.updatedAt).toLocaleTimeString()}</Label>
        <Label theme={theme} muted size={11}>Last {data.retainedLimit} records per project · Requires monitor.persist in each agent.</Label>
      </View>
    </>}
  </ScrollView>;
}
