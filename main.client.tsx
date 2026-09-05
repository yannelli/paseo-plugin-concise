import { type PluginSurfaceProps, type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/react-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { snapshot } from "./contracts.shared";
import { Activity } from "./activity.client";
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
  const [paused, setPaused] = useState<Awaited<ReturnType<typeof fetchSnapshot>> | null>(null);
  const query = useQuery({ queryKey: ["concise", "snapshot", selected], queryFn: () => fetchSnapshot(selected ? { cwd: selected } : {}),
    refetchInterval: paused ? false : 2000, retry: 1 });
  const data = paused ?? query.data;
  const project = data?.projects.find((item) => item.cwd === selected);
  const name = selected ? project?.name ?? selected.split("/").filter(Boolean).pop() : "All projects";
  const choose = (value: string) => { setSelected(value); setPaused(null); setProjectsOpen(false); };

  return <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
    contentContainerStyle={{ padding: layout.compact ? 16 : 32, gap: 24, width: "100%", maxWidth: 1200, alignSelf: "center" }}>
    <View style={{ gap: 18 }}>
      <Row>
        <View style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface2, borderRadius: 11 }}>
          <Icon name="ListFilter" size={21} color={theme.colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: layout.compact ? 24 : 28, fontWeight: "600", letterSpacing: -0.8 }}>Be concise</Text>
          <Label theme={theme} muted size={12}>A closer look at every hook.</Label>
        </View>
        <View accessibilityRole="text" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: query.isError ? theme.colors.statusDanger : paused ? theme.colors.statusWarning : data?.connected ? theme.colors.statusSuccess : theme.colors.foregroundMuted }} />
          <Label theme={theme} muted size={12}>{query.isError ? "Disconnected" : paused ? "Paused" : data?.connected ? "Live · 2s" : "Connecting"}</Label>
        </View>
      </Row>
      <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 12, justifyContent: "space-between" }}>
        <Chips theme={theme} value={tab} onChange={setTab} items={[{ value: "activity", label: "Activity" }, { value: "configuration", label: "Configuration" }, { value: "playground", label: "Playground" }]} />
        {!cwd && <Button theme={theme} label={`${name} ${projectsOpen ? "−" : "+"}`} onPress={() => setProjectsOpen(!projectsOpen)} />}
        {cwd && <Label theme={theme} muted>{name}</Label>}
      </View>
      {projectsOpen && <Card theme={theme}>
        {[{ cwd: "", key: "all", name: "All projects" }, ...(data?.projects ?? [])].map((item) => <Pressable key={item.key}
          accessibilityRole="button" accessibilityLabel={`Select ${item.name}`} onPress={() => choose(item.cwd)}
          style={{ padding: 10, gap: 3, borderRadius: 8, backgroundColor: item.cwd === selected ? theme.colors.surface2 : theme.colors.surface1 }}>
          <Label theme={theme}>{item.name}</Label>
          {!!item.cwd && <Label theme={theme} muted size={11}>{item.cwd}</Label>}
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
      {tab === "activity" && <Activity key={selected} theme={theme} compact={layout.compact} events={data.events} stats={data.stats}
        paused={Boolean(paused)} onPause={() => setPaused(paused ? null : data)} />}
      {tab !== "activity" && !selected && <Card theme={theme}>
        <Label theme={theme} size={18}>Choose a project</Label><Label theme={theme} muted>Configuration and previews use the selected project’s settings.</Label>
        <Button theme={theme} label="Choose project" onPress={() => setProjectsOpen(true)} />
      </Card>}
      {tab === "configuration" && selected && <ConfigurationEditor key={selected} cwd={selected} theme={theme} compact={layout.compact} />}
      {tab === "playground" && selected && <Playground key={selected} cwd={selected} theme={theme} compact={layout.compact} />}
      <View style={{ borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 14, gap: 4 }}>
        <Label theme={theme} muted size={11}>be-concise {data.version} · Last {data.retainedLimit} events per project · Updated {new Date(data.updatedAt).toLocaleTimeString()}</Label>
        <Label theme={theme} muted size={11}>Activity follows saved hook records. Capture requires be-concise 0.7.0+ and monitor.persist enabled in each agent.</Label>
      </View>
    </>}
  </ScrollView>;
}
