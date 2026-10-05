import type { PluginTheme } from "@getpaseo/plugin";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { at, ChoiceSetting, type Form, isObject, ToggleSetting } from "./config-form";
import { Badge, Button, Chips, Field, Heading, Label, MultiChips, Notice, Row, Toggle } from "./ui";

type Entry = { id: string; match?: string; value?: string; fix?: string; on?: string; caseSensitive?: boolean; flags?: string; hooks?: string[]; scopes?: string[]; enabled?: boolean };
type Draft = { id: string; idEdited: boolean; value: string; fix: string; match: string; on: string; caseSensitive: boolean; flags: string; hooks: string[]; scopes: string[] };
const PATH = "features.dictionary.entries";
const ID = /^[a-z0-9][a-z0-9-]*$/;
const MATCHES = ["exact", "contains", "startsWith", "endsWith", "regex"];
const UNITS = ["word", "line", "text"];
const HOOKS = [{ value: "edit", label: "File edits" }, { value: "bash", label: "Commits and gh" }, { value: "stop", label: "Replies" }, { value: "subagentStop", label: "Subagent replies" }];
const SCOPES = ["files", "comments", "gh", "commit", "command", "reply"].map((value) => ({ value, label: value }));
const matchHints: Record<string, string> = {
  exact: "Matches the whole value.", contains: "Matches the value anywhere; on word, it reports the whole word.",
  startsWith: "Matches text that starts with the value.", endsWith: "Matches text that ends with the value.",
  regex: "A regular expression. A named group (?<hit>...) sets the quoted part.",
};
const unitHints: Record<string, string> = { word: "Compares with words and phrases.", line: "Compares with each trimmed line.", text: "Compares with the whole scanned text." };
const entries = (value: unknown): Entry[] => Array.isArray(value) ? value.filter((item): item is Entry => isObject(item) && typeof item.id === "string") : [];

export function slug(value: string) {
  const text = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (text) return text;
  let hash = 0x811c9dc5;
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return `entry-${hash.toString(16).padStart(8, "0").slice(0, 6)}`;
}

const blank: Draft = { id: "", idEdited: false, value: "", fix: "", match: "exact", on: "word", caseSensitive: false, flags: "", hooks: [], scopes: [] };
const toDraft = (entry: Entry): Draft => ({ ...blank, id: entry.id, idEdited: true, value: entry.value ?? "", fix: entry.fix ?? "", match: entry.match ?? "exact",
  on: entry.on ?? "word", caseSensitive: entry.caseSensitive === true, flags: entry.flags ?? "", hooks: entry.hooks ?? [], scopes: entry.scopes ?? [] });

export function toEntry(draft: Draft): Entry {
  const regex = draft.match === "regex";
  return { id: draft.id, match: draft.match, value: draft.value, fix: draft.fix,
    ...(!regex && draft.on !== "word" ? { on: draft.on } : {}), ...(draft.caseSensitive && !(regex && draft.flags) ? { caseSensitive: true } : {}),
    ...(regex && draft.flags ? { flags: draft.flags } : {}), ...(draft.hooks.length ? { hooks: draft.hooks } : {}), ...(draft.scopes.length ? { scopes: draft.scopes } : {}) };
}

export function draftProblem(draft: Draft, taken: string[]) {
  if (!draft.value.trim()) return "Enter the term or pattern to flag.";
  if (!draft.fix.trim()) return "Enter the fix the agent sees.";
  if (!ID.test(draft.id)) return "The id takes lowercase letters, digits, and hyphens, and starts with a letter or digit.";
  if (taken.includes(draft.id)) return `This file already has an entry with id ${draft.id}.`;
  return null;
}

/** Maps "features.dictionary.entries[2]: reason" from a failed save to entry 2. */
export function entryErrors(message: string | undefined): Map<number, string> {
  const found = new Map<number, string>();
  for (const match of (message ?? "").matchAll(/features\.dictionary\.entries\[(\d+)\]: ([^\n]+)/g)) found.set(Number(match[1]), match[2]);
  return found;
}

function Summary({ theme, entry }: { theme: PluginTheme; entry: Entry }) {
  const scope = [entry.hooks?.length ? `Hooks: ${entry.hooks.join(", ")}` : "", entry.scopes?.length ? `Scopes: ${entry.scopes.join(", ")}` : ""].filter(Boolean).join(" · ");
  return <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
    <Row>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{entry.id}</Text>
      {entry.enabled === false ? <Badge theme={theme} label="off" /> : <Badge theme={theme} label={`${entry.match ?? "exact"}${entry.on && entry.match !== "regex" ? ` · ${entry.on}` : ""}`} />}
    </Row>
    {entry.enabled !== false && <Text selectable style={{ color: theme.colors.foreground, fontSize: 12 }}>
      <Text style={{ fontFamily: "monospace" }}>{entry.value}</Text><Text style={{ color: theme.colors.foregroundMuted }}>{"  →  "}</Text>{entry.fix}
    </Text>}
    {!!scope && <Label theme={theme} muted size={11}>{scope}</Label>}
  </View>;
}

export function DictionarySection({ form, saveError }: { form: Form; saveError?: string }) {
  const { theme } = form;
  const [editing, setEditing] = useState<{ index: number | null; draft: Draft } | null>(null);
  const own = entries(at(form.value, PATH));
  const ownIds = own.map((entry) => entry.id);
  const inherited = entries(at(form.effective, PATH)).filter((entry) => !ownIds.includes(entry.id));
  const errors = entryErrors(saveError);
  const write = (next: Entry[]) => form.set(PATH, next.length ? next : undefined);
  const taken = editing ? ownIds.filter((_, index) => index !== editing.index) : [];
  const problem = editing ? draftProblem(editing.draft, taken) : null;
  const change = (patch: Partial<Draft>) => setEditing((current) => {
    if (!current) return current;
    const draft = { ...current.draft, ...patch };
    return { ...current, draft: !draft.idEdited && patch.value !== undefined ? { ...draft, id: patch.value.trim() ? slug(patch.value) : "" } : draft };
  });
  function save() {
    if (!editing || problem) return;
    const entry = toEntry({ ...editing.draft, fix: editing.draft.fix.trim() });
    write(editing.index === null ? [...own, entry] : own.map((item, index) => index === editing.index ? entry : item));
    setEditing(null);
  }
  const draft = editing?.draft;
  return <View style={{ gap: 8, minWidth: 0 }}>
    <Heading theme={theme} title="Dictionary" description="Terms to flag, each with its own match rule and fix. Entries merge across layers by id." />
    <ToggleSetting form={form} path="features.dictionary.enabled" label="Dictionary check" hint="Runs once at least one entry is on." />
    <ChoiceSetting form={form} path="features.dictionary.mode" label="Dictionary mode" values={["confirm", "ask", "deny"]} />
    <Heading theme={theme} title={`Entries in this file (${own.length})`} />
    {own.length === 0 && <Label theme={theme} muted size={12}>No entries in this file.</Label>}
    {own.map((entry, index) => <View key={`${entry.id}-${index}`} style={{ gap: 6, padding: 8, borderWidth: 1, borderRadius: 6, minWidth: 0,
      borderColor: errors.has(index) ? theme.colors.statusDanger : theme.colors.border }}>
      <Row>
        <Summary theme={theme} entry={entry} />
        {entry.enabled === false
          ? <Button theme={theme} label="Turn on" accessibilityLabel={`Remove the override that turns off ${entry.id}`} onPress={() => write(own.filter((_, item) => item !== index))} />
          : <>
            <Button theme={theme} label="Edit" accessibilityLabel={`Edit ${entry.id}`} onPress={() => setEditing({ index, draft: toDraft(entry) })} />
            <Button theme={theme} label="Remove" accessibilityLabel={`Remove ${entry.id}`} onPress={() => write(own.filter((_, item) => item !== index))} />
          </>}
      </Row>
      {entry.enabled === false && <Label theme={theme} muted size={11}>Turned off in this file.</Label>}
      {errors.has(index) && <Notice theme={theme} tone="danger">{errors.get(index)!}</Notice>}
    </View>)}
    {!editing && <Row><Button theme={theme} label="Add entry" primary onPress={() => setEditing({ index: null, draft: blank })} /></Row>}
    {draft && <View style={{ gap: 10, padding: 10, borderWidth: 1, borderColor: theme.colors.accent, borderRadius: 8, minWidth: 0 }}>
      <Label theme={theme} size={14}>{editing.index === null ? "New entry" : `Edit ${own[editing.index]?.id}`}</Label>
      <Field theme={theme} label={draft.match === "regex" ? "Pattern" : "Term or phrase"} monospace value={draft.value} onChange={(value) => change({ value })} placeholder={draft.match === "regex" ? "\\bJIRA-\\d+\\b" : "blacklist"} />
      <Field theme={theme} label="Fix" value={draft.fix} onChange={(fix) => change({ fix })} placeholder="denylist" />
      <Label theme={theme} muted>Match</Label>
      <Chips theme={theme} items={MATCHES.map((value) => ({ value, label: value }))} value={draft.match} onChange={(match) => change({ match })} />
      <Label theme={theme} muted size={11}>{matchHints[draft.match]}</Label>
      {draft.match !== "regex" && <>
        <Label theme={theme} muted>Compare with</Label>
        <Chips theme={theme} items={UNITS.map((value) => ({ value, label: value }))} value={draft.on} onChange={(on) => change({ on })} />
        <Label theme={theme} muted size={11}>{unitHints[draft.on]}</Label>
      </>}
      {draft.match === "regex" && <Field theme={theme} label="Flags" monospace value={draft.flags} onChange={(flags) => change({ flags: flags.replace(/[^a-z]/g, "") })} placeholder="i (default)" />}
      {draft.match === "regex" && !!draft.flags && <Label theme={theme} muted size={11}>Flags set the case rule. Include i to ignore case.</Label>}
      {!(draft.match === "regex" && draft.flags) && <Row><View style={{ flex: 1, minWidth: 0 }}><Label theme={theme}>Case sensitive</Label></View>
        <Toggle theme={theme} label="Case sensitive" checked={draft.caseSensitive} onChange={(caseSensitive) => change({ caseSensitive })} /></Row>}
      <Label theme={theme} muted>Hooks · none selected means all</Label>
      <MultiChips theme={theme} label="Hooks" items={HOOKS} value={draft.hooks} onChange={(hooks) => change({ hooks })} />
      <Label theme={theme} muted>Scopes · none selected means all except command</Label>
      <MultiChips theme={theme} label="Scopes" items={SCOPES} value={draft.scopes} onChange={(scopes) => change({ scopes })} />
      <Field theme={theme} label="Id" monospace value={draft.id} onChange={(id) => change({ id: id.toLowerCase(), idEdited: true })} placeholder="blacklist" />
      <Label theme={theme} muted size={11}>Denials carry the tag [concise:dictionary:{draft.id || "id"}].</Label>
      {problem && (draft.value || draft.fix) && <Notice theme={theme} tone="warning">{problem}</Notice>}
      <Row>
        <Button theme={theme} label={editing.index === null ? "Add to draft" : "Update draft"} primary disabled={Boolean(problem)} onPress={save} />
        <Button theme={theme} label="Cancel" onPress={() => setEditing(null)} />
      </Row>
    </View>}
    {inherited.length > 0 && <>
      <Heading theme={theme} title={`From other layers (${inherited.length})`} description="Turn one off here, or copy it into this file to change it." />
      {inherited.map((entry) => <View key={entry.id} style={{ gap: 6, padding: 8, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.border, borderRadius: 6, minWidth: 0 }}>
        <Row>
          <Summary theme={theme} entry={entry} />
          {entry.enabled !== false && <>
            <Button theme={theme} label="Turn off here" accessibilityLabel={`Turn off ${entry.id} in this file`} onPress={() => write([...own, { id: entry.id, enabled: false }])} />
            <Button theme={theme} label="Copy here" accessibilityLabel={`Copy ${entry.id} into this file`} onPress={() => setEditing({ index: null, draft: toDraft(entry) })} />
          </>}
        </Row>
      </View>)}
    </>}
  </View>;
}
