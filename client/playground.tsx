import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { preview } from "../shared/contracts";
import { Badge, Button, Card, Chips, decisionColor, Field, Label, Notice, Row } from "./ui";

type Kind = "Write" | "apply_patch" | "Bash" | "Stop";
type JsonObject = Record<string, unknown>;
type Finding = { category?: string; match?: string; line?: number; fix?: string | null };
type HookRun = { hook: string; decision: string; durationMs?: number; findings: Finding[]; reason: string; error?: string | null };
const kinds: { value: Kind; label: string; field: string }[] = [
  { value: "Write", label: "File write", field: "File content" }, { value: "apply_patch", label: "Patch (Codex, omp)", field: "Patch" },
  { value: "Bash", label: "Shell command", field: "Command text" }, { value: "Stop", label: "Final reply", field: "Reply text" },
];
const examples: Record<Kind, string> = {
  Write: "This comprehensive solution will seamlessly streamline your workflow — effortlessly.",
  apply_patch: "*** Begin Patch\n*** Add File: notes.md\n+This comprehensive solution will seamlessly streamline your workflow.\n*** End Patch",
  Bash: "gh pr create --title 'Update notes' --body 'This comprehensive update seamlessly streamlines the workflow.'",
  Stop: "Absolutely! This comprehensive solution will seamlessly streamline your workflow.",
};
const verdicts: [string[], string][] = [[["deny", "block", "error"], "Rejected"], [["ask"], "Needs approval"], [["flag"], "Allowed with a notice"],
  [["rewrite", "filter"], "Rewritten"], [["bypass"], "Bypassed"], [["allow", "context"], "Allowed"]];
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const pretty = (json: string) => { try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; } };

export function hookRuns(json: string): HookRun[] {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return []; }
  const { hooks, matches } = object(parsed);
  const known = (Array.isArray(matches) ? matches : []).map(object);
  // The runner copies the fix of the first match on the same line and category, so look up the exact match.
  const fixOf = (name: string, finding: Finding) => known.find((match) => match.hook === name && match.category === finding.category
    && match.line === finding.line && (match.match === finding.match || match.snippet === finding.match))?.fix;
  return (Array.isArray(hooks) ? hooks : []).map((value) => {
    const hook = object(value);
    const response = object(hook.response);
    const output = object(response.hookSpecificOutput);
    const name = text(hook.hook) || "hook";
    return { hook: name, decision: text(hook.decision) || "unknown",
      durationMs: typeof hook.durationMs === "number" ? hook.durationMs : undefined,
      findings: (Array.isArray(hook.findings) ? hook.findings.map(object) as Finding[] : []).map((finding) => ({ ...finding, fix: text(fixOf(name, finding)) || finding.fix })),
      reason: text(output.permissionDecisionReason) || text(response.reason) || text(response.systemMessage) || text(output.additionalContext),
      error: typeof hook.error === "string" ? hook.error : null };
  });
}

export function verdict(runs: HookRun[]) {
  for (const [names, label] of verdicts) {
    const match = runs.find((run) => names.includes(run.decision));
    if (match) return { label, decision: match.decision };
  }
  return { label: runs.length ? "Unknown" : "No hook ran", decision: "unknown" };
}

export function Playground({ cwd, theme, compact }: { cwd: string; theme: PluginTheme; compact: boolean }) {
  const run = useRpc(preview);
  const [kind, setKind] = useState<Kind>("Write");
  const [value, setValue] = useState("");
  const [path, setPath] = useState("notes.md");
  const [raw, setRaw] = useState(false);
  const mutation = useMutation({ mutationFn: run });
  const matches = mutation.variables?.cwd === cwd;
  const changed = matches && (mutation.variables?.kind !== kind || mutation.variables?.text !== value || mutation.variables?.path !== path);
  const runs = matches && mutation.data ? hookRuns(mutation.data.json) : [];
  const outcome = verdict(runs);
  const field = kinds.find((item) => item.value === kind)!.field;
  return <View style={{ gap: compact ? 12 : 16 }}>
    <View style={{ gap: 5 }}><Label theme={theme} size={18}>Playground</Label><Label theme={theme} muted>Preview the hook response with this project’s saved configuration.</Label></View>
    <Card theme={theme}>
      <Chips theme={theme} items={kinds} value={kind} onChange={(next) => { setKind(next as Kind); mutation.reset(); }} />
      {kind === "Write" && <Field theme={theme} label="Target path" value={path} onChange={setPath} placeholder="notes.md" monospace />}
      <Field theme={theme} label={field} value={value} onChange={setValue} multiline placeholder={examples[kind]} />
      <Label theme={theme} muted size={12}>Preview does not run the command or write target files. Agent environment overrides apply separately.</Label>
      <Row>
        <Button theme={theme} label={mutation.isPending ? "Running preview…" : "Run preview"} primary disabled={mutation.isPending || !value.trim() || (kind === "Write" && !path.trim())}
          onPress={() => mutation.mutate({ cwd, kind, text: value, path })} />
        {!value && <Button theme={theme} label="Use example" onPress={() => setValue(examples[kind])} />}
      </Row>
      {matches && mutation.isError && <Notice theme={theme} tone="danger">{`Preview failed: ${mutation.error.message}`}</Notice>}
    </Card>
    {matches && mutation.data && <Card theme={theme}>
      <Row>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: decisionColor(theme, outcome.decision) }} />
        <View style={{ flex: 1, minWidth: 0 }}><Label theme={theme} size={16}>{outcome.label}</Label></View>
        <Label theme={theme} muted size={12}>{kinds.find((item) => item.value === mutation.variables?.kind)?.label}</Label>
      </Row>
      {changed && <Label theme={theme} muted size={12}>Inputs changed since this preview. Run it again to update the response.</Label>}
      {runs.map((item, index) => <View key={`${item.hook}-${index}`} style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderColor: theme.colors.border, minWidth: 0 }}>
        <Row>
          <Badge theme={theme} label={item.decision} color={decisionColor(theme, item.decision)} />
          <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "500" }}>{item.hook}</Text></View>
          {item.durationMs !== undefined && <Label theme={theme} muted size={11}>{Math.round(item.durationMs)} ms</Label>}
        </Row>
        {!!item.error && <Notice theme={theme} tone="danger">{item.error}</Notice>}
        {!!item.reason && <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 18 }}>{item.reason}</Text>}
        {item.findings.map((finding, position) => <Text key={position} selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          {finding.line !== undefined ? `Line ${finding.line} · ` : ""}{finding.category ?? "finding"}{finding.match ? ` · “${finding.match}”` : ""}{finding.fix ? ` → ${finding.fix}` : ""}
        </Text>)}
      </View>)}
      <Row><Button theme={theme} label={raw ? "Hide raw response" : "Raw response"} onPress={() => setRaw(!raw)} /></Row>
      {raw && <Text selectable accessibilityLabel="Preview JSON response" style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: compact ? 11 : 12, lineHeight: 18 }}>
        {pretty(mutation.data.json)}</Text>}
    </Card>}
  </View>;
}
