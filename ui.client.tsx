import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

export function Label({ theme, children, muted = false, size = 13 }: {
  theme: PluginTheme; children: ReactNode; muted?: boolean; size?: number;
}) {
  return <Text selectable style={{ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: size, lineHeight: size * 1.5 }}>{children}</Text>;
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>{children}</View>;
}

export function Card({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  return <View style={{ backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 14 }}>{children}</View>;
}

export function Button({ theme, label, onPress, disabled = false, primary = false }: {
  theme: PluginTheme; label: string; onPress: () => void; disabled?: boolean; primary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 40, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9,
      borderWidth: 1, borderColor: primary ? theme.colors.accent : theme.colors.border,
      backgroundColor: primary ? theme.colors.accent : theme.colors.surface1, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}>
    <Text style={{ color: primary ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{label}</Text>
  </Pressable>;
}

export function Chips({ theme, items, value, onChange }: {
  theme: PluginTheme; items: { value: string; label: string }[]; value: string; onChange: (value: string) => void;
}) {
  return <Row>{items.map((item) => <Pressable key={item.value} accessibilityRole="button" accessibilityLabel={item.label}
    accessibilityState={{ selected: value === item.value }} onPress={() => onChange(item.value)}
    style={{ minHeight: 38, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
      borderWidth: 1, borderColor: value === item.value ? theme.colors.accent : theme.colors.border,
      backgroundColor: value === item.value ? theme.colors.surface2 : theme.colors.surface0 }}>
    <Text style={{ color: value === item.value ? theme.colors.foreground : theme.colors.foregroundMuted, fontWeight: value === item.value ? "600" : "400", fontSize: 12 }}>{item.label}</Text>
  </Pressable>)}</Row>;
}

export function Field({ theme, label, value, onChange, multiline = false, placeholder }: {
  theme: PluginTheme; label: string; value: string; onChange: (value: string) => void; multiline?: boolean; placeholder?: string;
}) {
  return <View style={{ gap: 6 }}>
    <Label theme={theme} muted>{label}</Label>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline}
      autoCapitalize="none" autoCorrect={false} placeholder={placeholder} placeholderTextColor={theme.colors.foregroundMuted}
      style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface0, borderColor: theme.colors.border,
        borderWidth: 1, borderRadius: 9, padding: 12, fontSize: 13, minHeight: multiline ? 160 : 42,
        textAlignVertical: multiline ? "top" : "center", fontFamily: multiline ? "monospace" : undefined }} />
  </View>;
}

export function decisionColor(theme: PluginTheme, decision: string) {
  if (["deny", "block", "error"].includes(decision)) return theme.colors.statusDanger;
  if (["ask", "flag"].includes(decision)) return theme.colors.statusWarning;
  if (["rewrite", "bypass"].includes(decision)) return theme.colors.accent;
  return theme.colors.statusSuccess;
}
