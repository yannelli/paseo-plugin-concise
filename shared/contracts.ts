import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ObjectSchema = z.record(z.string(), z.unknown());
export const ProjectSchema = z.object({ key: z.string(), name: z.string(), cwd: z.string(), lastSeen: z.string() });
export const EventSchema = z.object({
  id: z.string(), timestamp: z.string(), project: z.string(), projectName: z.string(),
  hook: z.string(), tool: z.string(), decision: z.string(), session: z.string(),
  durationMs: z.number(), target: z.string(), summary: z.string(),
});
export type ActivityEvent = z.infer<typeof EventSchema>;
export const LayerSchema = z.object({
  id: z.string(), label: z.string(), path: z.string(), exists: z.boolean(), text: z.string(),
  revision: z.string().nullable(), active: z.boolean(), error: z.string().optional(),
});
export type ConfigLayer = z.infer<typeof LayerSchema>;
export const ConfigurationSchema = z.object({
  defaults: ObjectSchema, effective: ObjectSchema, layers: z.array(LayerSchema),
  filterLayers: z.array(LayerSchema), environment: z.record(z.string(), z.string()),
});
export type Configuration = z.infer<typeof ConfigurationSchema>;
export const TargetSchema = z.object({ cwd: z.string().min(1) });
export const StatsSchema = z.object({
  total: z.number(), interventions: z.number(), sessions: z.number(), averageMs: z.number(),
  decisions: z.array(z.object({ name: z.string(), count: z.number() })),
  hooks: z.array(z.object({ name: z.string(), count: z.number() })),
  minutes: z.array(z.object({ timestamp: z.string(), count: z.number() })),
});
export type ActivityStats = z.infer<typeof StatsSchema>;
export const snapshot = defineRpc({
  name: "concise.snapshot", input: z.object({ cwd: z.string().optional() }),
  output: z.object({
    connected: z.boolean(), version: z.string().nullable(), root: z.string().nullable(),
    message: z.string().nullable(), projects: z.array(ProjectSchema), events: z.array(EventSchema),
    stats: StatsSchema, updatedAt: z.string(), retainedLimit: z.number(),
  }),
});
export const eventDetail = defineRpc({
  name: "concise.event", input: z.object({ id: z.string() }), output: z.object({ json: z.string() }),
});
export const readConfiguration = defineRpc({
  name: "concise.config.read", input: TargetSchema, output: ConfigurationSchema,
});
export const writeConfiguration = defineRpc({
  name: "concise.config.write",
  input: TargetSchema.extend({ id: z.string(), text: z.string().max(262144), revision: z.string().nullable() }),
  output: ConfigurationSchema,
});
export const preview = defineRpc({
  name: "concise.preview",
  input: TargetSchema.extend({ kind: z.enum(["Write", "apply_patch", "Bash", "Stop"]), text: z.string().max(65536), path: z.string().max(1024) }),
  output: z.object({ json: z.string() }),
});
