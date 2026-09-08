import type { Configuration } from "./contracts";

export function enforcementUpdate(state: Configuration, enabled: boolean, provider: string) {
  const active = state.layers.find((layer) => layer.active && layer.id.startsWith("project-"));
  if (active?.id === "project-override") throw new Error("Quick toggles are unavailable with BEC_CONFIG_PATH. Edit that file in Configuration.");
  const preferred = provider.toLowerCase().includes("codex") ? "project-codex" : "project-claude";
  const layer = active ?? state.layers.find((item) => item.id === preferred);
  if (!layer) throw new Error("The workspace configuration layer is unavailable.");
  if (layer.error) throw new Error(layer.error);
  let value: unknown;
  try { value = layer.exists ? JSON.parse(layer.text) : {}; }
  catch { throw new Error("The workspace configuration contains invalid JSON. Repair it in Configuration."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The workspace configuration must be a JSON object.");
  return { id: layer.id, revision: layer.revision, text: `${JSON.stringify({ ...value, softFail: !enabled }, null, 2)}\n` };
}
