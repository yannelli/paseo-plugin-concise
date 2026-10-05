import { useRpc } from "@getpaseo/plugin/client";
import { useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { type TuneKind, tune } from "../shared/contracts";
import { type Form, mergeDelta } from "./config-form";
import { PRESETS } from "./config-sections";
import { Button, Chips, Field, Heading, Label, Notice, Row } from "./ui";

const KINDS: { value: TuneKind; label: string }[] = [
  { value: "docs", label: "Docs" }, { value: "reply", label: "Replies" }, { value: "commit", label: "Commits" },
  { value: "gh", label: "PR bodies" }, { value: "comments", label: "Code comments" },
];
const MAX_SAMPLES = 20;

export function TunerSection({ form, cwd }: { form: Form; cwd: string }) {
  const { theme } = form;
  const run = useRpc(tune);
  const [kind, setKind] = useState<TuneKind>("docs");
  const [preset, setPreset] = useState("");
  const [samples, setSamples] = useState([""]);
  const [applied, setApplied] = useState(0);
  const mutation = useMutation({ mutationFn: run, onMutate: () => setApplied(0) });
  const texts = samples.filter((text) => text.trim());
  const result = mutation.data;
  const stale = Boolean(mutation.variables && (mutation.variables.kind !== kind || (mutation.variables.preset ?? "") !== preset || mutation.variables.texts.join("\0") !== texts.join("\0")));
  const edit = (index: number, text: string) => setSamples((current) => current.map((item, position) => position === index ? text : item));
  return <View style={{ gap: 10, minWidth: 0 }}>
    <Heading theme={theme} title="Writing tuner" description="Paste writing you accept. The tuner scans it with every pack and proposes settings it passes. Nothing is saved until you apply and save." />
    <Label theme={theme} muted>Sample kind</Label>
    <Chips theme={theme} items={KINDS} value={kind} onChange={(value) => setKind(value as TuneKind)} />
    <Label theme={theme} muted>Target preset</Label>
    <Chips theme={theme} items={[{ value: "", label: "Current" }, ...PRESETS.map((value) => ({ value, label: value }))]} value={preset} onChange={setPreset} />
    {samples.map((text, index) => <View key={index} style={{ gap: 6, minWidth: 0 }}>
      <Field theme={theme} label={`Sample ${index + 1}`} multiline value={text} onChange={(value) => edit(index, value)}
        placeholder={kind === "commit" ? "fix(parser): keep trailing comments" : "Paste one document, reply, or message."} />
      {samples.length > 1 && <Row><Button theme={theme} label="Remove sample" accessibilityLabel={`Remove sample ${index + 1}`} onPress={() => setSamples(samples.filter((_, item) => item !== index))} /></Row>}
    </View>)}
    <Row>
      <Button theme={theme} label="Add sample" disabled={samples.length >= MAX_SAMPLES} onPress={() => setSamples([...samples, ""])} />
      <Button theme={theme} label={mutation.isPending ? "Analyzing…" : "Analyze samples"} primary disabled={mutation.isPending || texts.length === 0}
        onPress={() => mutation.mutate({ cwd, kind, texts, ...(preset ? { preset } : {}) })} />
    </Row>
    <Label theme={theme} muted size={11}>Separate samples score better: a category that fires in 2 or more samples is turned off. Up to {MAX_SAMPLES} samples.</Label>
    {mutation.isError && <Notice theme={theme} tone="danger">{`Tuning failed: ${mutation.error.message}`}</Notice>}
    {result && <View style={{ gap: 8, minWidth: 0 }}>
      <Label theme={theme}>{result.samples} {result.samples === 1 ? "sample" : "samples"} · {result.words.toLocaleString()} words</Label>
      {stale && <Label theme={theme} muted size={12}>The inputs changed since this result. Analyze again to update it.</Label>}
      {result.evidence.length === 0 && <Notice theme={theme} tone="success">No changes proposed. The samples pass the current settings.</Notice>}
      {result.evidence.map((item) => <View key={`${item.key}:${JSON.stringify(item.value)}`} style={{ gap: 3, padding: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, minWidth: 0 }}>
        <Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 }}>{item.key} = {JSON.stringify(item.value)}</Text>
        <Label theme={theme} muted size={12}>{item.reason}</Label>
        {item.examples.map((example, index) => <Text key={index} selectable numberOfLines={2} style={{ color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 11 }}>{example}</Text>)}
      </View>)}
      {result.kept.length > 0 && <View style={{ gap: 3 }}>
        <Label theme={theme} size={12}>Left on</Label>
        {result.kept.map((item) => <Label key={item.category} theme={theme} muted size={12}>{item.category}: {item.reason}</Label>)}
      </View>}
      {result.insufficient.length > 0 && <View style={{ gap: 3 }}>
        <Label theme={theme} size={12}>Needs more words</Label>
        {result.insufficient.map((item) => <Label key={item.pack} theme={theme} muted size={12}>{item.pack}: {item.words} of {item.minWords} words</Label>)}
      </View>}
      {result.evidence.length > 0 && <Row>
        <Button theme={theme} label={applied ? "Applied to draft" : "Apply to draft"} primary disabled={Boolean(applied) || stale}
          onPress={() => { form.replace(mergeDelta(form.value, result.delta)); setApplied(result.evidence.length); }} />
      </Row>}
      {applied > 0 && <Notice theme={theme} tone="success">{`Applied ${applied} ${applied === 1 ? "change" : "changes"} to this file's draft. Review the other sections, then save.`}</Notice>}
    </View>}
  </View>;
}
