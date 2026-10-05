import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { type HostId, type HostStatus, installerApply, installerStatus } from "../shared/contracts";
import { compareVersions } from "../shared/versions";
import { Button, Card, Chips, Label, Row } from "./ui";

const queryKey = ["concise", "installer"];

function actionLabel(host: HostStatus, version: string) {
  if (host.source && !host.managed) return `Switch to GitHub releases ${version}`;
  if (!host.version) return `Install ${version}`;
  const order = compareVersions(version, host.version);
  return order > 0 ? `Update to ${version}` : order < 0 ? `Downgrade to ${version}` : `Reinstall ${version}`;
}

function hostSummary(host: HostStatus) {
  if (!host.available || host.error) return host.error ?? "Unavailable";
  if (!host.version) return "Not installed";
  return `Installed ${host.version}${host.enabled ? "" : " · Disabled"}`;
}

export function Installer({ theme, compact }: { theme: PluginTheme; compact: boolean }) {
  const read = useRpc(installerStatus);
  const apply = useRpc(installerApply);
  const cache = useQueryClient();
  const query = useQuery({ queryKey, queryFn: () => read({}), staleTime: 60_000, retry: 1,
    refetchInterval: (current) => current.state.data?.job?.running ? 1500 : false });
  const [chosen, setChosen] = useState("");
  const [confirming, setConfirming] = useState<{ host: HostId; action: "switch" | "remove" } | null>(null);
  const refresh = useMutation({ mutationFn: () => read({ refresh: true }), onSuccess: (data) => cache.setQueryData(queryKey, data) });
  const mutation = useMutation({ mutationFn: apply, onSuccess: (data) => { cache.setQueryData(queryKey, data); setConfirming(null); } });
  const job = query.data?.job ?? null;
  const running = useRef(false);
  useEffect(() => {
    if (running.current && !job?.running) {
      void cache.invalidateQueries({ queryKey: ["concise", "snapshot"] });
      void cache.invalidateQueries({ queryKey: ["concise", "configuration"] });
    }
    running.current = Boolean(job?.running);
  }, [cache, job?.running]);
  if (query.isPending) return <Label theme={theme} muted>Reading be-concise releases and hosts…</Label>;
  if (!query.data) return <Card theme={theme}><Label theme={theme}>{query.error?.message ?? "Release status is unavailable."}</Label><Button theme={theme} label="Retry" onPress={() => { void query.refetch(); }} /></Card>;
  const { releases, hosts } = query.data;
  const latest = releases[0];
  const version = releases.some((release) => release.version === chosen) ? chosen : latest?.version ?? "";
  const busy = mutation.isPending || refresh.isPending || Boolean(job?.running);
  return <View style={{ gap: compact ? 12 : 16 }}>
    <View style={{ gap: 5 }}>
      <Label theme={theme} size={18}>be-concise plugin</Label>
      <Label theme={theme} muted>Install, update, or remove the Claude Code and Codex plugin from {query.data.repository} GitHub releases.</Label>
    </View>
    <Card theme={theme}>
      <Row>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label theme={theme}>{latest ? `Latest release ${latest.version}` : "No compatible release found"}</Label>
          {latest?.publishedAt && <Label theme={theme} muted size={12}>Published {new Date(latest.publishedAt).toLocaleDateString()}</Label>}
        </View>
        <Button theme={theme} label={refresh.isPending ? "Checking…" : "Check for updates"} disabled={busy} onPress={() => refresh.mutate()} />
      </Row>
      {(refresh.error?.message ?? query.data.releasesError) && <Label theme={theme}>{refresh.error?.message ?? query.data.releasesError}</Label>}
      {releases.length > 1 && <Chips theme={theme} items={releases.slice(0, 6).map((release) => ({ value: release.version, label: release.version }))} value={version} onChange={setChosen} />}
    </Card>
    {hosts.map((host) => {
      const external = Boolean(host.source && !host.managed);
      const confirm = confirming?.host === host.id ? confirming.action : null;
      const install = () => mutation.mutate({ host: host.id, action: "install", version, switchSource: external });
      return <Card key={host.id} theme={theme}>
        <View style={{ minWidth: 0 }}>
          <Label theme={theme}>{host.label}</Label>
          <Label theme={theme} muted size={12}>{hostSummary(host)}</Label>
        </View>
        {host.available && !host.error && <Label theme={theme} muted size={12}>Marketplace: {host.source ? `${host.source}${host.managed ? " · GitHub release" : ""}` : "not added"}</Label>}
        {confirm === "switch" && <Label theme={theme}>This replaces the be-concise marketplace source {host.source} with a downloaded GitHub release. The result lists the replaced source.</Label>}
        {host.available && !host.error && <Row>
          {!!version && !confirm && <Button theme={theme} primary={!host.version || external || compareVersions(version, host.version) > 0} disabled={busy}
            label={actionLabel(host, version)} onPress={() => external ? setConfirming({ host: host.id, action: "switch" }) : install()} />}
          {confirm === "switch" && <Button theme={theme} primary disabled={busy} label={`Confirm switch to ${version}`} onPress={install} />}
          {(host.version || host.managed) && confirm !== "switch" && <Button theme={theme} disabled={busy} label={confirm === "remove" ? "Confirm remove" : "Remove"}
            onPress={() => confirm === "remove" ? mutation.mutate({ host: host.id, action: "remove" }) : setConfirming({ host: host.id, action: "remove" })} />}
          {confirm && <Button theme={theme} label="Cancel" disabled={busy} onPress={() => setConfirming(null)} />}
        </Row>}
        {mutation.isError && mutation.variables?.host === host.id && <Label theme={theme}>Failed: {mutation.error.message}</Label>}
        {job?.host === host.id && job.running && <Label theme={theme} muted>Working… Downloads and host commands can take a minute.</Label>}
        {job?.host === host.id && job.error && !mutation.isError && <Label theme={theme}>Failed: {job.error}</Label>}
        {job?.host === host.id && job.message && !mutation.isError && <Label theme={theme}>{job.message}</Label>}
      </Card>;
    })}
    <Label theme={theme} muted size={11}>Releases are stored in {query.data.directory}. Claude Code changes use user scope.</Label>
  </View>;
}
