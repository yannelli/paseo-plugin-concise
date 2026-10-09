import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type ConfigLayer, readConfiguration, writeConfiguration } from "../shared/contracts";
import { compareVersions } from "../shared/versions";
import { at, type Form, isObject, type JsonObject, update } from "./config-form";
import { ChecksSection, ExceptionsSection, LimitsSection, LoggingSection, StyleSection } from "./config-sections";
import { DictionarySection } from "./dictionary";
import { TunerSection } from "./tuner";
import { Badge, Button, Card, Chips, Field, Label, Notice, Row } from "./ui";

type Draft = { text: string; original: string; revision: string | null };
export type Drafts = Record<string, Draft>;
type Props = { cwd: string; theme: PluginTheme; compact: boolean; version: string | null; visible: boolean;
  drafts: Drafts; setDrafts: React.Dispatch<React.SetStateAction<Drafts>> };
const initialText = (layer: ConfigLayer) => layer.exists || layer.id.startsWith("filter-") ? layer.text : "{}\n";
const problemsOf = (effective: JsonObject) => Array.isArray(effective.problems)
  ? effective.problems.filter(isObject).map((item) => `${String(item.source ?? "configuration")}: ${String(item.reason ?? "invalid")}`) : [];

function parse(text: string): { value: JsonObject; error?: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (!isObject(value)) throw new Error("Configuration must be a JSON object.");
    return { value };
  } catch (error) {
    return { value: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

export const hasUnsaved = (drafts: Drafts, cwd: string) => Object.entries(drafts).some(([key, draft]) => key.startsWith(`${cwd}\0`) && draft.text !== draft.original);

export function ConfigurationEditor({ cwd, theme, compact, version, visible, drafts, setDrafts }: Props) {
  const read = useRpc(readConfiguration);
  const write = useRpc(writeConfiguration);
  const cache = useQueryClient();
  const queryKey = ["concise", "configuration", cwd];
  const query = useQuery({ queryKey, queryFn: () => read({ cwd }), refetchInterval: visible ? 3000 : false });
  const [selected, setSelected] = useState("");
  const [json, setJson] = useState(false);
  const [section, setSection] = useState("limits");
  const [inspect, setInspect] = useState("");
  const [saved, setSaved] = useState<{ key: string; message: string }>();
  const [discards, setDiscards] = useState(0);
  const all = [...(query.data?.layers ?? []), ...(query.data?.filterLayers ?? [])];
  const layer = all.find((item) => item.id === selected) ?? [...(query.data?.layers ?? [])].reverse().find((item) => item.active) ?? all[0];
  const key = `${cwd}\0${layer?.id ?? ""}`;
  const draft = drafts[key];
  const text = draft?.text ?? (layer ? initialText(layer) : "");
  const dirty = Boolean(draft && draft.text !== draft.original);
  const filter = layer?.id.startsWith("filter-") ?? false;
  const parsed: ReturnType<typeof parse> = filter ? { value: {} } : parse(text);
  const externalChange = Boolean(draft && layer && draft.revision !== layer.revision);
  const mutation = useMutation({
    mutationFn: write,
    onSuccess(data, input) {
      const savedKey = `${input.cwd}\0${input.id}`;
      const updated = [...data.layers, ...data.filterLayers].find((item) => item.id === input.id);
      cache.setQueryData(["concise", "configuration", input.cwd], data);
      setDrafts((current) => {
        const next = { ...current };
        if (next[savedKey]?.text === input.text) delete next[savedKey];
        else if (next[savedKey] && updated) next[savedKey] = { ...next[savedKey], revision: updated.revision, original: initialText(updated) };
        return next;
      });
      setSaved({ key: savedKey, message: `Saved ${updated?.label ?? input.id}. Hooks read it on their next call.` });
      void cache.invalidateQueries({ queryKey: ["concise", "configuration"] });
    },
  });
  const saveError = mutation.isError && mutation.variables?.cwd === cwd && mutation.variables.id === layer?.id ? mutation.error.message : undefined;
  function edit(nextText: string) {
    if (!layer) return;
    setSaved(undefined);
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? { original: initialText(layer), revision: layer.revision }), text: nextText } }));
  }
  function discard() {
    setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
    mutation.reset();
    setSaved(undefined);
    setDiscards((count) => count + 1);
  }
  async function reload() {
    const result = await query.refetch();
    if (!result.isError) discard();
  }
  if (query.isPending) return <Label theme={theme} muted>Loading configuration…</Label>;
  if (!query.data) return <Card theme={theme}><Label theme={theme}>{query.error?.message ?? "Configuration is unavailable."}</Label><Button theme={theme} label="Retry" onPress={() => { void query.refetch(); }} /></Card>;
  const effective = query.data.effective;
  const problems = problemsOf(effective);
  const top = [...query.data.layers].reverse().find((item) => item.active)?.id === layer?.id;
  const form: Form = { theme, compact, value: parsed.value, effective, defaults: query.data.defaults, top,
    set: (path, value) => edit(`${JSON.stringify(update(parsed.value, path, value), null, 2)}\n`),
    replace: (value) => edit(`${JSON.stringify(value, null, 2)}\n`) };
  const tuner = Boolean(version && compareVersions(version, "0.10.0") >= 0);
  const sections = [{ value: "limits", label: "Limits" }, { value: "checks", label: "Checks" }, { value: "style", label: "Style" },
    ...(at(query.data.defaults, "features.dictionary") ? [{ value: "dictionary", label: "Dictionary" }] : []),
    { value: "exceptions", label: "Exceptions" }, { value: "logging", label: "Logging" }, ...(tuner ? [{ value: "tune", label: "Tune" }] : [])];
  const current = sections.some((item) => item.value === section) ? section : "limits";
  const unsaved = (id: string) => { const item = drafts[`${cwd}\0${id}`]; return Boolean(item && item.text !== item.original); };
  const save = () => layer && mutation.mutate({ cwd, id: layer.id, text, revision: draft?.revision ?? layer.revision });
  const actions = layer && <Row>
    <Button theme={theme} label={mutation.isPending ? "Saving…" : "Save changes"} primary disabled={!dirty || mutation.isPending || Boolean(parsed.error) || externalChange} onPress={save} />
    <Button theme={theme} label="Discard" disabled={!dirty || mutation.isPending} onPress={discard} />
    {(externalChange || saveError) && <Button theme={theme} label="Reload from disk" disabled={mutation.isPending || query.isFetching} onPress={() => { void reload(); }} />}
  </Row>;
  const layerButton = (item: ConfigLayer) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.id === layer?.id }}
    accessibilityLabel={`Edit ${item.label}, ${item.active ? "active" : "inactive"}, ${item.exists ? "exists" : "new file"}${unsaved(item.id) ? ", unsaved changes" : ""}`}
    onPress={() => setSelected(item.id)} style={{ padding: 8, borderRadius: 6, gap: 4, minWidth: 0, backgroundColor: item.id === layer?.id ? theme.colors.surface2 : "transparent",
      borderWidth: 1, borderColor: item.id === layer?.id ? theme.colors.accent : "transparent" }}>
    <Row>
      <View style={{ flex: 1, minWidth: 0 }}><Label theme={theme}>{item.label}</Label></View>
      {unsaved(item.id) && <Badge theme={theme} label="Unsaved" color={theme.colors.statusWarning} />}
      {!item.id.startsWith("filter-") && <Badge theme={theme} label={item.active ? "Active" : "Inactive"} color={item.active ? theme.colors.statusSuccess : theme.colors.foregroundMuted} />}
      <Badge theme={theme} label={item.exists ? "Exists" : "New file"} />
    </Row>
    <Text selectable numberOfLines={2} style={{ color: theme.colors.foregroundMuted, fontSize: 11, minWidth: 0 }}>{item.path}</Text>
  </Pressable>;
  return <View style={{ gap: compact ? 12 : 16 }}>
    <View style={{ gap: 5 }}><Label theme={theme} size={18}>Configuration</Label><Label theme={theme} muted>Choose a file, change its settings, then save. Keys you do not set are inherited from lower layers.</Label></View>
    {query.isError && <Notice theme={theme} tone="danger">{`Refresh failed: ${query.error.message}`}</Notice>}
    {problems.length > 0 && <Notice theme={theme} tone="warning">
      <Label theme={theme} size={12}>be-concise skipped part of the configuration:</Label>
      {problems.map((problem) => <Label key={problem} theme={theme} muted size={12}>{problem}</Label>)}
    </Notice>}
    <Card theme={theme}>
      <Label theme={theme} muted size={12}>Configuration files · an active file overrides the active files above it</Label>
      {query.data.layers.map(layerButton)}
      {query.data.filterLayers.length > 0 && <Label theme={theme} muted size={12}>Test output filter files</Label>}
      {query.data.filterLayers.map(layerButton)}
    </Card>
    {layer && <Card theme={theme}>
      <Row>
        <View style={{ flex: 1, minWidth: 0 }}><Label theme={theme} size={17}>{layer.label}</Label><Label theme={theme} muted size={12}>{dirty ? "Unsaved changes" : "No unsaved changes"}</Label></View>
        {!filter && <Chips theme={theme} items={[{ value: "form", label: "Form" }, { value: "json", label: "JSON" }]} value={json || parsed.error ? "json" : "form"} onChange={(value) => setJson(value === "json")} />}
      </Row>
      {!layer.active && !filter && <Notice theme={theme} tone="warning">{layer.exists ? "Another file takes precedence over this one, so its settings are not in effect." : "This file does not exist yet. Saving creates it, which can change which file is in effect."}</Notice>}
      {layer.error && <Notice theme={theme} tone="danger">{layer.error}</Notice>}
      {externalChange && <Notice theme={theme} tone="warning">This file changed on disk. Your draft is kept. Reload discards the draft and reads the current file.</Notice>}
      {dirty && !filter && !json && !parsed.error && actions}
      {(json || filter || parsed.error) ? <>
        {parsed.error && <Notice theme={theme} tone="danger">{`Invalid JSON: ${parsed.error}`}</Notice>}
        <Field theme={theme} label={filter ? "Test filter assignments" : "Layer JSON"} value={text} onChange={edit} multiline />
        <Label theme={theme} muted>{filter ? "One FILTER_LINES, FILTER_CONTEXT, FILTER_TAIL, FILTER_PATTERN, or NOFILTER assignment per line." : "Only keys in this file become overrides. Other keys stay inherited."}</Label>
      </> : <>
        <Chips theme={theme} items={sections} value={current} onChange={setSection} />
        {sections.map(({ value }) => <View key={value} style={{ display: current === value ? "flex" : "none" }}>
          {value === "limits" && <LimitsSection form={form} />}
          {value === "checks" && <ChecksSection form={form} />}
          {value === "style" && <StyleSection form={form} />}
          {value === "dictionary" && <DictionarySection key={`${layer.id}:${discards}`} form={form} saveError={saveError} />}
          {value === "exceptions" && <ExceptionsSection form={form} />}
          {value === "logging" && <LoggingSection form={form} />}
          {value === "tune" && <TunerSection form={form} cwd={cwd} />}
        </View>)}
      </>}
      {!tuner && !!version && !json && !filter && <Label theme={theme} muted size={11}>be-concise {version} is installed. The dictionary and writing tuner need 0.10.0 or newer. Update it in the Plugin tab.</Label>}
      {saveError && <Notice theme={theme} tone="danger">{`Save failed: ${saveError}`}</Notice>}
      {saved?.key === key && <Notice theme={theme} tone="success">{saved.message}</Notice>}
      {actions}
    </Card>}
    <Card theme={theme}>
      <Label theme={theme}>Effective configuration</Label><Label theme={theme} muted>Resolved from the files and the Paseo daemon environment. Agent environment overrides apply separately.</Label>
      <Chips theme={theme} items={[{ value: "", label: "Hide details" }, { value: "effective", label: "Effective JSON" }, { value: "environment", label: "Daemon environment" }]} value={inspect} onChange={setInspect} />
      {inspect && <Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 }}>{JSON.stringify(inspect === "effective" ? effective : query.data.environment, null, 2)}</Text>}
      {inspect === "environment" && <Label theme={theme} muted>Sanitized BEC_* variables from the daemon process.</Label>}
    </Card>
  </View>;
}
