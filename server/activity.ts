import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import type { ActivityEvent, ActivityStats } from "../shared/contracts.ts";

export const RETAINED = 500;
export const HISTORY_BYTES = 16 * 1024 * 1024;
const RECORD_BYTES = 2 * 1024 * 1024;
type ObjectValue = Record<string, unknown>;
type StoredEvent = { event: ActivityEvent; cwd: string; json: string; bytes: number };

const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const text = (value: unknown, limit: number): string => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";

export function canonicalPath(cwd: string): string {
  try { return realpathSync(cwd); } catch { return cwd; }
}

export function normalizeEvent(value: unknown, id: string, now = Date.now()): { event: ActivityEvent; cwd: string } | null {
  const record = object(value);
  if (typeof record.cwd !== "string" || typeof record.hook !== "string") return null;
  const cwd = canonicalPath(record.cwd);
  const request = object(record.request);
  const input = object(request.tool_input);
  const response = object(record.response);
  const output = object(response.hookSpecificOutput);
  const date = typeof record.ts === "string" ? Date.parse(record.ts) : NaN;
  const duration = typeof record.durationMs === "number" && Number.isFinite(record.durationMs) ? Math.max(0, record.durationMs) : 0;
  return {
    cwd,
    event: {
      id, timestamp: new Date(Number.isFinite(date) ? date : now).toISOString(),
      project: text(record.project, 64) || createHash("sha256").update(cwd).digest("hex"),
      projectName: text(record.projectName, 100) || basename(cwd),
      hook: text(record.hook, 80), tool: text(record.tool || request.tool_name || record.event, 80),
      decision: text(record.decision, 40) || "unknown",
      session: text(record.session || request.session_id, 160), durationMs: duration,
      target: text(input.file_path || input.path || input.command || record.path, 180),
      summary: text(record.error || output.permissionDecisionReason || response.reason || response.systemMessage || output.additionalContext, 280),
    },
  };
}

export function activityStats(events: ActivityEvent[], now = Date.now()): ActivityStats {
  const counts = (key: "decision" | "hook") => {
    const values = new Map<string, number>();
    for (const event of events) values.set(event[key], (values.get(event[key]) || 0) + 1);
    return [...values].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };
  const end = Math.floor(now / 60_000) * 60_000;
  const minutes = Array.from({ length: 30 }, (_, index) => ({ timestamp: new Date(end - (29 - index) * 60_000).toISOString(), count: 0 }));
  const start = end - 29 * 60_000;
  for (const event of events) {
    const index = Math.floor((Date.parse(event.timestamp) - start) / 60_000);
    if (index >= 0 && index < minutes.length) minutes[index].count++;
  }
  return {
    total: events.length,
    interventions: events.filter(({ decision }) => ["deny", "ask", "block"].includes(decision)).length,
    sessions: new Set(events.map(({ session }) => session).filter(Boolean)).size,
    averageMs: events.length ? Math.round(events.reduce((sum, event) => sum + event.durationMs, 0) / events.length * 10) / 10 : 0,
    decisions: counts("decision"), hooks: counts("hook"), minutes,
  };
}

export class ActivityStore {
  private records: StoredEvent[] = [];
  private bytes = 0;
  private sequence = 0;
  private readonly prefix = randomUUID();
  private readonly retained: number;
  private readonly byteLimit: number;

  constructor(retained = RETAINED, byteLimit = HISTORY_BYTES) { this.retained = retained; this.byteLimit = byteLimit; }

  publish(value: unknown): void {
    let json: string;
    try { json = JSON.stringify(value); } catch { return; }
    if (typeof json !== "string") return;
    const bytes = Buffer.byteLength(json);
    if (bytes > RECORD_BYTES || bytes > this.byteLimit) return;
    const normalized = normalizeEvent(value, `${this.prefix}:${++this.sequence}`);
    if (!normalized) return;
    this.records.push({ ...normalized, json, bytes });
    this.bytes += bytes;
    const matching = this.records.filter(({ event }) => event.project === normalized.event.project);
    if (matching.length > this.retained) this.remove(this.records.indexOf(matching[0]));
    while (this.bytes > this.byteLimit && this.records.length) this.remove(0);
  }

  private remove(index: number): void {
    this.bytes -= this.records[index].bytes;
    this.records.splice(index, 1);
  }

  events(cwd?: string): ActivityEvent[] {
    const canonical = cwd ? canonicalPath(cwd) : null;
    return this.records.filter((record) => !canonical || record.cwd === canonical).map(({ event }) => event)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || Number(b.id.split(":").at(-1)) - Number(a.id.split(":").at(-1)));
  }

  detail(id: string): string {
    const stored = this.records.find(({ event }) => event.id === id);
    if (!stored) throw new Error("This event is no longer in retained history. Refresh activity.");
    return stored.json;
  }

  clear(): void { this.records = []; this.bytes = 0; }
}
