import { type PluginTheme, useRpc } from "@getpaseo/plugin";
import { useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { preview } from "./contracts.shared";
import { Button, Card, Chips, Field, Label } from "./ui.client";

type Kind = "Write" | "apply_patch" | "Bash" | "Stop";
const labels: Record<Kind, string> = { Write: "File content", apply_patch: "Patch", Bash: "Command text", Stop: "Final reply" };
const examples: Record<Kind, string> = {
  Write: "This comprehensive solution will seamlessly streamline your workflow — effortlessly.",
  apply_patch: "*** Begin Patch\n*** Add File: notes.md\n+This comprehensive solution will seamlessly streamline your workflow.\n*** End Patch",
  Bash: "gh pr create --title 'Update notes' --body 'This comprehensive update seamlessly streamlines the workflow.'",
  Stop: "Absolutely! This comprehensive solution will seamlessly streamline your workflow.",
};

export function Playground({ cwd, theme, compact }: { cwd: string; theme: PluginTheme; compact: boolean }) {
  const run = useRpc(preview);
  const [kind, setKind] = useState<Kind>("Write");
  const [text, setText] = useState("");
  const [path, setPath] = useState("notes.md");
  const mutation = useMutation({ mutationFn: run });
  const matches = mutation.variables?.cwd === cwd;
  const changed = matches && (mutation.variables?.kind !== kind || mutation.variables?.text !== text || mutation.variables?.path !== path);
  return <View style={{ gap: compact ? 12 : 16 }}>
    <View style={{ gap: 5 }}><Label theme={theme} size={compact ? 20 : 24}>Playground</Label><Label theme={theme} muted>Preview a hook response with this project’s current configuration.</Label></View>
    <Card theme={theme}>
      <Chips theme={theme} items={(["Write", "apply_patch", "Bash", "Stop"] as Kind[]).map((value) => ({ value, label: value }))} value={kind} onChange={(value) => { setKind(value as Kind); mutation.reset(); }} />
      {kind === "Write" && <Field theme={theme} label="Target path" value={path} onChange={setPath} placeholder="notes.md" />}
      <Field theme={theme} label={labels[kind]} value={text} onChange={setText} multiline placeholder={examples[kind]} />
      <Label theme={theme} muted>Preview does not run the command or write target files. Agent environment overrides apply independently.</Label>
      <Button theme={theme} label={mutation.isPending ? "Running preview…" : "Run preview"} primary disabled={mutation.isPending || !text.trim() || (kind === "Write" && !path.trim())} onPress={() => mutation.mutate({ cwd, kind, text, path })} />
      {matches && mutation.isError && <Label theme={theme}>Preview failed: {mutation.error.message}</Label>}
    </Card>
    {matches && mutation.data && <Card theme={theme}>
      <Label theme={theme}>Hook response · {mutation.variables?.kind}</Label>
      {changed && <Label theme={theme} muted>Inputs changed since this preview. Run again to update the response.</Label>}
      <Text selectable accessibilityLabel="Preview JSON response" style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: compact ? 12 : 13, lineHeight: 20 }}>{mutation.data.json}</Text>
    </Card>}
  </View>;
}
