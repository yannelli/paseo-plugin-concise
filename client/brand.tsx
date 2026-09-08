import type { PluginTheme } from "@getpaseo/plugin";
import { Image, View } from "react-native";
import { brandIcon } from "../shared/brand-icon";

export function BrandIcon({ theme, size = 20, monochrome = false, color = theme.colors.foreground }: { theme: PluginTheme; size?: number; monochrome?: boolean; color?: string }) {
  const imageSize = size * 256 / 180;
  const offset = -size * 38 / 180;
  const style = { width: imageSize, height: imageSize, position: "absolute" as const, left: offset, top: (size - imageSize) / 2 };
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, overflow: "hidden", flexShrink: 0 }}>
    <Image source={{ uri: brandIcon }} style={[style, monochrome && { tintColor: color }]} />
    {!monochrome && <View style={{ width: size * 0.78, height: size, overflow: "hidden" }}>
      <Image source={{ uri: brandIcon }} style={[style, { tintColor: theme.colors.foreground }]} />
    </View>}
  </View>;
}
