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
export const TuneKindSchema = z.enum(["docs", "reply", "commit", "gh", "comments"]);
export type TuneKind = z.infer<typeof TuneKindSchema>;
export const TuneResultSchema = z.object({
  kind: TuneKindSchema, samples: z.number(), words: z.number(), delta: ObjectSchema,
  evidence: z.array(z.object({ key: z.string(), value: z.unknown(), reason: z.string(), examples: z.array(z.string()) })),
  kept: z.array(z.object({ category: z.string(), reason: z.string() })),
  insufficient: z.array(z.object({ pack: z.string(), words: z.number(), minWords: z.number() })),
});
export type TuneResult = z.infer<typeof TuneResultSchema>;
export const tune = defineRpc({
  name: "concise.tune",
  input: TargetSchema.extend({ kind: TuneKindSchema, texts: z.array(z.string().min(1).max(65536)).min(1).max(20), preset: z.string().max(64).optional() }),
  output: TuneResultSchema,
});
export const HostIdSchema = z.enum(["claude", "codex"]);
export type HostId = z.infer<typeof HostIdSchema>;
export const ReleaseSchema = z.object({ version: z.string(), tag: z.string(), name: z.string(), publishedAt: z.string(), url: z.string() });
export const HostSchema = z.object({
  id: HostIdSchema, label: z.string(), available: z.boolean(), version: z.string().nullable(), enabled: z.boolean(),
  source: z.string().nullable(), managed: z.boolean(), error: z.string().nullable(),
});
export type HostStatus = z.infer<typeof HostSchema>;
export const InstallActionSchema = z.enum(["install", "remove"]);
export const JobSchema = z.object({
  host: HostIdSchema, action: InstallActionSchema, version: z.string().nullable(), running: z.boolean(),
  message: z.string().nullable(), error: z.string().nullable(),
});
export const InstallerSchema = z.object({
  repository: z.string(), directory: z.string(), releases: z.array(ReleaseSchema),
  releasesError: z.string().nullable(), checkedAt: z.string(), hosts: z.array(HostSchema), job: JobSchema.nullable(),
});
export type InstallerStatus = z.infer<typeof InstallerSchema>;
export const installerStatus = defineRpc({
  name: "concise.installer.status", input: z.object({ refresh: z.boolean().optional() }), output: InstallerSchema,
});
export const installerApply = defineRpc({
  name: "concise.installer.apply",
  input: z.object({ host: HostIdSchema, action: InstallActionSchema, version: z.string().max(32).optional(), switchSource: z.boolean().optional() }),
  output: InstallerSchema,
});
