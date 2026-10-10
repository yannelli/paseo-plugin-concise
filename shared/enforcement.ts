import type { Configuration } from "./contracts";

export function enforcementUpdate(state: Configuration, enabled: boolean, provider: string) {
  const active = state.layers.find((layer) => layer.active && layer.id.startsWith("project-"));
  // Before be-concise 0.13.1, BEC_CONFIG_PATH replaced the project file. From 0.13.1 it is the env-config layer under user and project files.
  if (active?.id === "project-override") throw new Error("Quick toggles are unavailable with BEC_CONFIG_PATH before be-concise 0.13.1. Edit that file in Configuration.");
  // BEC_CONFIG_PATH_ONLY (0.13.1) skips the user and project files, so a project write would have no effect.
  if (/^(1|true|yes|on)$/i.test(state.environment.BEC_CONFIG_PATH_ONLY?.trim() ?? "")) {
    throw new Error("Quick toggles are unavailable with BEC_CONFIG_PATH_ONLY. Edit the BEC_CONFIG_PATH file in Configuration.");
  }
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
