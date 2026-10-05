import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { type ReactNode, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Chips, Field, Label, Notice, Row, Toggle } from "./ui";

export type JsonObject = Record<string, unknown>;
export type Form = {
  theme: PluginTheme; compact: boolean; value: JsonObject; effective: JsonObject; defaults: JsonObject; top: boolean;
  set(path: string, value: unknown): void; replace(value: JsonObject): void;
};

export const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
export const at = (value: unknown, path: string): unknown => path.split(".").reduce<unknown>((node, key) => isObject(node) ? node[key] : undefined, value);
export const supports = (form: Form, path: string) => at(form.defaults, path) !== undefined;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const show = (value: unknown) => value === null ? "default" : typeof value === "string" ? value
  : Array.isArray(value) ? `${value.length} ${value.length === 1 ? "item" : "items"}` : JSON.stringify(value);
const strings = (value: unknown) => Array.isArray(value) ? value.map(String) : [];

export function update(source: JsonObject, path: string, value: unknown): JsonObject {
  const [key, ...rest] = path.split(".");
  const next = { ...source };
  if (rest.length) {
    const child = update(isObject(next[key]) ? next[key] : {}, rest.join("."), value);
    if (Object.keys(child).length) next[key] = child;
    else delete next[key];
  } else if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** Mirrors be-concise mergeDelta: objects merge, lists gain new items, other values replace. */
export function mergeDelta(target: JsonObject, delta: JsonObject): JsonObject {
  const next = { ...target };
  for (const [key, value] of Object.entries(delta)) {
    const current = next[key];
    if (isObject(value)) next[key] = mergeDelta(isObject(current) ? current : {}, value);
    else if (Array.isArray(value) && Array.isArray(current)) next[key] = [...current, ...value.filter((item) => !current.some((prior) => same(prior, item)))];
    else next[key] = value;
  }
  return next;
}

function Origin({ form, path, compare }: { form: Form; path: string; compare: boolean }) {
  const own = at(form.value, path);
  const effective = at(form.effective, path);
  const text = own === undefined ? "Inherited" : !compare || same(own, effective) ? "Set in this file" : `Set in this file · Effective value: ${show(effective)}`;
  return <Label theme={form.theme} muted size={11}>{text}</Label>;
}

export function Setting({ form, path, label, hint, children, below, compare = true }: {
  form: Form; path: string; label: string; hint?: string; children?: ReactNode; below?: ReactNode; compare?: boolean;
}) {
  const own = at(form.value, path) !== undefined;
  return <View style={{ gap: 8, minWidth: 0, paddingVertical: 4 }}>
    <Row>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Label theme={form.theme}>{label}</Label>
        {!!hint && <Label theme={form.theme} muted size={12}>{hint}</Label>}
        <Origin form={form} path={path} compare={compare} />
      </View>
      {own && <Button theme={form.theme} label="Use inherited" accessibilityLabel={`Use inherited ${label}`} onPress={() => form.set(path, undefined)} />}
      {children}
    </Row>
    {below}
  </View>;
}

export function ToggleSetting({ form, path, label, hint }: { form: Form; path: string; label: string; hint?: string }) {
  if (!supports(form, path)) return null;
  const checked = (at(form.value, path) ?? at(form.effective, path)) === true;
  return <Setting form={form} path={path} label={label} hint={hint}>
    <Toggle theme={form.theme} label={label} checked={checked} onChange={(value) => form.set(path, value)} />
  </Setting>;
}

export function ChoiceSetting({ form, path, label, hint, values }: { form: Form; path: string; label: string; hint?: string; values: string[] }) {
  if (!supports(form, path)) return null;
  const current = String(at(form.value, path) ?? at(form.effective, path) ?? "");
  return <Setting form={form} path={path} label={label} hint={hint}
    below={<Chips theme={form.theme} items={values.map((value) => ({ value, label: value }))} value={current} onChange={(value) => form.set(path, value)} />} />;
}

export function NumberSetting({ form, path, label, hint, min = 1 }: { form: Form; path: string; label: string; hint?: string; min?: number }) {
  if (!supports(form, path)) return null;
  const own = at(form.value, path);
  const low = typeof own === "number" && own < min;
  return <Setting form={form} path={path} label={label} hint={hint} below={low ? <Notice theme={form.theme} tone="warning">{`Use ${min} or more.`}</Notice> : undefined}>
    <View style={{ width: 96 }}>
      <Field theme={form.theme} label={label} hideLabel value={own === undefined ? "" : String(own)} placeholder={show(at(form.effective, path))}
        onChange={(value) => { if (/^\d{0,9}$/.test(value)) form.set(path, value ? Number(value) : undefined); }} />
    </View>
  </Setting>;
}

export function TextSetting({ form, path, label, hint, placeholder }: { form: Form; path: string; label: string; hint?: string; placeholder?: string }) {
  if (!supports(form, path)) return null;
  const own = at(form.value, path);
  return <Setting form={form} path={path} label={label} hint={hint}
    below={<Field theme={form.theme} label={label} hideLabel monospace value={typeof own === "string" ? own : ""}
      placeholder={placeholder ?? show(at(form.effective, path))} onChange={(value) => form.set(path, value || undefined)} />} />;
}

function Item({ theme, text, onRemove, label }: { theme: PluginTheme; text: string; onRemove?: () => void; label: string }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28, paddingLeft: 8, paddingRight: onRemove ? 2 : 8,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, backgroundColor: onRemove ? theme.colors.surface0 : "transparent", maxWidth: "100%" }}>
    <Text selectable numberOfLines={1} style={{ color: onRemove ? theme.colors.foreground : theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 12, flexShrink: 1 }}>{text}</Text>
    {onRemove && <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${text} from ${label}`} onPress={onRemove} hitSlop={6}
      style={({ pressed }) => ({ padding: 4, borderRadius: 4, opacity: pressed ? 0.6 : 1 })}>
      <Icon name="X" size={12} color={theme.colors.foregroundMuted} />
    </Pressable>}
  </View>;
}

const mergeHints = {
  replace: "A list in this file replaces the inherited list.",
  union: "Inherited items always apply. Items in this file add to them.",
  layer: "Only the items this file sets are shown.",
};

/** merge follows be-concise layer rules: replace, union, or enable/disable lists that cancel across layers. */
export function ListSetting({ form, path, label, hint, merge, placeholder }: {
  form: Form; path: string; label: string; hint?: string; merge: "replace" | "union" | "layer"; placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  if (!supports(form, path)) return null;
  const { theme } = form;
  const ownValue = at(form.value, path);
  const own = Array.isArray(ownValue) ? ownValue.map(String) : undefined;
  const effective = strings(at(form.effective, path));
  const base = form.top ? effective : strings(at(form.defaults, path));
  const editable = merge === "replace" ? own ?? base : own ?? [];
  const inherited = merge === "union" ? effective.filter((item) => !editable.includes(item)) : [];
  const seeded = merge === "replace" && !own;
  const write = (next: string[]) => form.set(path, next.length || merge === "replace" ? next : undefined);
  const value = input.trim();
  const duplicate = editable.includes(value) || inherited.includes(value);
  const add = () => { if (!value || duplicate) return; write([...editable, value]); setInput(""); };
  return <Setting form={form} path={path} label={label} compare={false} hint={hint ? `${hint} ${mergeHints[merge]}` : mergeHints[merge]} below={<View style={{ gap: 8, minWidth: 0 }}>
    {seeded && editable.length > 0 && <Label theme={theme} muted size={11}>{form.top ? "Showing the inherited list." : "Showing the built-in list."} A change copies it into this file.</Label>}
    {editable.length > 0 ? <Row>{editable.map((item) => <Item key={item} theme={theme} text={item} label={label} onRemove={() => write(editable.filter((entry) => entry !== item))} />)}</Row>
      : <Label theme={theme} muted size={12}>{merge === "replace" && own ? "Empty list: nothing inherited applies." : "No items in this file."}</Label>}
    {inherited.length > 0 && <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${inherited.length} inherited ${label}`} onPress={() => setOpen(!open)}
        style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: 24 }}>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={theme.colors.foregroundMuted} />
        <Label theme={theme} muted size={12}>{inherited.length} inherited</Label>
      </Pressable>
      {open && <Row>{inherited.map((item) => <Item key={item} theme={theme} text={item} label={label} />)}</Row>}
    </View>}
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Field theme={theme} label={`Add to ${label}`} hideLabel monospace value={input} onChange={setInput} onSubmit={add} placeholder={placeholder ?? "Add an item"} />
      </View>
      <Button theme={theme} label="Add" accessibilityLabel={`Add to ${label}`} disabled={!value || duplicate} onPress={add} />
    </View>
    {duplicate && !!value && <Label theme={theme} muted size={11}>Already in the list.</Label>}
  </View>} />;
}
