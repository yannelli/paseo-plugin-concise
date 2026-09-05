import { type PluginTheme, useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type ConfigLayer, readConfiguration, writeConfiguration } from "./contracts.shared";
import { Button, Card, Chips, Field, Label, Row, Toggle } from "./ui.client";

type Props = { cwd: string; theme: PluginTheme; compact: boolean };
type JsonObject = Record<string, unknown>;
type Draft = { text: string; original: string; revision: string | null };
const limits = [["maxCommentLines", "Comment lines"], ["maxFileLines", "New file lines"], ["maxPrBodyParagraphs", "PR paragraphs"], ["maxPrBodySentences", "Sentences per paragraph"], ["maxRetries", "Retries"]];
const checks = [["checks.comments", "Comment length"], ["checks.fileSize", "File length"], ["checks.prBody", "PR body"], ["softFail", "Soft fail"], ["stopHook", "Check final replies"], ["monitor.persist", "Persist activity"]];
const presets = ["default", "ryan", "technical", "ste", "minimal", "all", "git", "statistical"];
const items = (values: string[]) => values.map((value) => ({ value, label: value }));
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const at = (value: unknown, path: string): unknown => path.split(".").reduce<unknown>((node, key) => object(node) ? node[key] : undefined, value);
const show = (value: unknown) => value === undefined ? "Inherited" : JSON.stringify(value);
const initialText = (layer: ConfigLayer) => layer.exists || layer.id.startsWith("filter-") ? layer.text : "{}\n";

function update(source: JsonObject, path: string, value: unknown): JsonObject {
  const [key, ...rest] = path.split(".");
  const next = { ...source };
  if (rest.length) {
    const child = update(object(next[key]) ? next[key] : {}, rest.join("."), value);
    if (Object.keys(child).length) next[key] = child;
    else delete next[key];
  } else if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

function parse(text: string): { value: JsonObject; error?: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (!object(value)) throw new Error("Configuration must be a JSON object.");
    return { value };
  } catch (error) {
    return { value: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

export function ConfigurationEditor({ cwd, theme, compact }: Props) {
  const read = useRpc(readConfiguration);
  const write = useRpc(writeConfiguration);
  const cache = useQueryClient();
  const queryKey = ["concise", "configuration", cwd];
  const query = useQuery({ queryKey, queryFn: () => read({ cwd }), refetchInterval: 3000 });
  const [selected, setSelected] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [advanced, setAdvanced] = useState(false);
  const [section, setSection] = useState("limits");
  const [inspect, setInspect] = useState("");
  const [saved, setSaved] = useState<{ key: string; message: string }>();
  const layers = [...(query.data?.layers ?? []), ...(advanced ? query.data?.filterLayers ?? [] : [])];
  const layer = layers.find((item) => item.id === selected) ?? [...(query.data?.layers ?? [])].reverse().find((item) => item.active) ?? layers[0];
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
      setSaved({ key: savedKey, message: `Saved ${updated?.label ?? input.id} · ${updated?.path ?? input.cwd}` });
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
  }
  async function reload() {
    const result = await query.refetch();
    if (!result.isError) discard();
  }
  function set(path: string, value: unknown) { edit(`${JSON.stringify(update(parsed.value, path, value), null, 2)}\n`); }
  const effective = query.data?.effective ?? {};
  function origin(path: string) {
    return <Label theme={theme} muted size={12}>Layer: {show(at(parsed.value, path))} · Effective: {show(at(effective, path))}</Label>;
  }
  function inherit(path: string) {
    return at(parsed.value, path) !== undefined ? <Button theme={theme} label="Inherit" onPress={() => set(path, undefined)} /> : null;
  }
  function toggle(path: string, label: string) {
    return <View key={path} style={{ gap: 4 }}>
      <Row><View style={{ flex: 1, minWidth: 0 }}><Label theme={theme}>{label}</Label>{origin(path)}</View>
        {inherit(path)}<Toggle theme={theme} label={label} checked={(at(parsed.value, path) ?? at(effective, path)) === true} onChange={(value) => set(path, value)} />
      </Row>
    </View>;
  }
  function choice(path: string, label: string, values: string[]) {
    return <View style={{ gap: 8 }}>
      <Row><View style={{ flex: 1, minWidth: 0 }}><Label theme={theme}>{label}</Label>{origin(path)}</View>{inherit(path)}</Row>
      <Chips theme={theme} items={items(values)} value={String(at(parsed.value, path) ?? at(effective, path) ?? "")} onChange={(value) => set(path, value)} />
    </View>;
  }
  if (query.isPending) return <Label theme={theme} muted>Loading configuration…</Label>;
  if (!query.data) return <Card theme={theme}><Label theme={theme}>{query.error?.message ?? "Configuration is unavailable."}</Label><Button theme={theme} label="Retry" onPress={() => { void query.refetch(); }} /></Card>;
  return <View style={{ gap: compact ? 12 : 16 }}>
    <View style={{ gap: 5 }}><Label theme={theme} size={18}>Configuration</Label><Label theme={theme} muted>Select a file to edit its overrides. Save applies the selected file.</Label></View>
    {query.isError && <Label theme={theme}>Refresh failed: {query.error.message}</Label>}
    <Card theme={theme}>
      {layers.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.id === layer?.id }} accessibilityLabel={`Edit ${item.label}, ${item.active ? "active" : "inactive"}, ${item.exists ? "exists" : "new file"}`} onPress={() => setSelected(item.id)} style={{ padding: 8, borderRadius: 6, gap: 4, backgroundColor: item.id === layer?.id ? theme.colors.surface2 : "transparent", borderWidth: 1, borderColor: item.id === layer?.id ? theme.colors.accent : "transparent" }}>
        <Row><View style={{ flex: 1, minWidth: 0 }}><Label theme={theme}>{item.label}{drafts[`${cwd}\0${item.id}`]?.text !== undefined && drafts[`${cwd}\0${item.id}`].text !== drafts[`${cwd}\0${item.id}`].original ? " · Unsaved" : ""}</Label></View><Label theme={theme} muted size={12}>{item.active ? "Active" : "Inactive"} · {item.exists ? "Exists" : "New file"}</Label></Row>
        <Text selectable numberOfLines={2} accessibilityLabel={item.path} style={{ color: theme.colors.foregroundMuted, fontSize: 11, minWidth: 0 }}>{item.path}</Text>
      </Pressable>)}
      <Button theme={theme} label={advanced ? "Hide advanced editor" : "Advanced editor & test filters"} onPress={() => setAdvanced((value) => !value)} />
    </Card>
    {layer && <Card theme={theme}>
      <Row><View style={{ flex: 1, minWidth: 0 }}><Label theme={theme} size={17}>{layer.label}</Label><Label theme={theme} muted>{dirty ? "Unsaved changes" : "No unsaved changes"}</Label></View></Row>
      {!layer.active && <Label theme={theme} muted>{layer.exists ? "Another file takes precedence over this layer." : "This file does not exist yet. Creating it changes file selection according to layer precedence."}</Label>}
      {layer.error && <Label theme={theme}>{layer.error}</Label>}
      {externalChange && <Label theme={theme}>This file changed on disk. Your draft is preserved. Reload discards this draft and reads the current file.</Label>}
      {(advanced || filter || parsed.error) ? <>
        {parsed.error && <Label theme={theme}>Invalid JSON: {parsed.error}</Label>}
        <Field theme={theme} label={filter ? "Test filter assignments" : "Layer JSON"} value={text} onChange={edit} multiline />
        <Label theme={theme} muted>{filter ? "One FILTER_* or NOFILTER assignment per line." : "Only keys in this file become overrides. Other keys remain inherited."}</Label>
      </> : <>
        <Chips theme={theme} items={[{ value: "limits", label: "Limits" }, { value: "checks", label: "Checks" }, { value: "style", label: "Style" }]} value={section} onChange={setSection} />
        {section === "limits" && limits.map(([path, label]) => <View key={path} style={{ gap: 4 }}>
          <Field theme={theme} label={label} value={at(parsed.value, path) === undefined ? "" : String(at(parsed.value, path))} placeholder={`Inherited · ${show(at(effective, path))}`} onChange={(value) => { if (/^\d*$/.test(value)) set(path, value ? Number(value) : undefined); }} />{origin(path)}
        </View>)}
        {section === "checks" && <>{checks.map(([path, label]) => toggle(path, label))}<Label theme={theme} muted>Soft fail allows a flagged call. Persist activity records hook requests and responses.</Label></>}
        {section === "style" && <>
          {toggle("features.emDash.enabled", "Dash check")}
          {toggle("features.emDash.enDash", "Include en dashes")}
          {toggle("features.emDash.doubleHyphen", "Include double hyphens")}
          {toggle("features.emDash.replies", "Check dashes in replies")}
          {choice("features.emDash.mode", "Dash mode", ["confirm", "ask", "deny"])}
          {toggle("features.aiWriting.enabled", "AI writing check")}
          {toggle("features.aiWriting.replies", "Check AI writing in replies")}
          {choice("features.aiWriting.preset", "Writing preset", presets)}
          {choice("features.aiWriting.mode", "Writing mode", ["confirm", "ask", "deny"])}
        </>}
      </>}
      {saveError && <Label theme={theme}>Save failed: {saveError}</Label>}
      {saved?.key === key && <Label theme={theme}>{saved.message}</Label>}
      <Row><Button theme={theme} label={mutation.isPending ? "Saving…" : "Save changes"} primary disabled={!dirty || mutation.isPending || Boolean(parsed.error) || externalChange} onPress={() => mutation.mutate({ cwd, id: layer.id, text, revision: draft?.revision ?? layer.revision })} />
        <Button theme={theme} label="Discard" disabled={!dirty || mutation.isPending} onPress={discard} />
        {(externalChange || saveError) && <Button theme={theme} label="Reload from disk" disabled={mutation.isPending || query.isFetching} onPress={() => { void reload(); }} />}
      </Row>
    </Card>}
    <Card theme={theme}>
      <Label theme={theme}>Effective configuration</Label><Label theme={theme} muted>Resolved using files and the Paseo daemon environment. Agent environment overrides apply independently.</Label>
      <Chips theme={theme} items={[{ value: "", label: "Hide details" }, { value: "effective", label: "Effective JSON" }, { value: "environment", label: "Daemon environment" }]} value={inspect} onChange={setInspect} />
      {inspect && <Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 }}>{JSON.stringify(inspect === "effective" ? query.data.effective : query.data.environment, null, 2)}</Text>}
      {inspect === "environment" && <Label theme={theme} muted>Sanitized BEC_* variables from the daemon process.</Label>}
    </Card>
  </View>;
}
