import type { SensorSource } from "@weather/contracts";

/**
 * Deliberate defects for the synthetic history (`pnpm db:seed --anomalies`): gaps, impossible or
 * wildly wrong single values, and a metric frozen at one value. They sit at KNOWN times, so an
 * algorithm that looks for them (the analytics quality tasks) can be scored: how many it found,
 * how many alarms were false. Everything here is pure; seed.ts only calls it and writes the manifest.
 */

export type SeedMetric = "fusedTemp" | "hum" | "bmpPress" | "mq5" | "mq3" | "pm25" | "pm10";

export type SeedRow = {
  source: SensorSource;
  recordedAt: Date;
  fusedTemp: number | null;
  hum: number | null;
  bmpPress: number | null;
  mq5: number | null;
  mq3: number | null;
  pm25: number | null;
  pm10: number | null;
};

export type AnomalyKind = "gap" | "outlier" | "stuck";

export type AnomalyPlan = {
  source: SensorSource;
  kind: AnomalyKind;
  /** Metric the anomaly touches; a gap removes whole rows and has none. */
  metric?: SeedMetric;
  /** Replacement value of an outlier. */
  value?: number;
  /** First and last affected row time (inclusive), on the step grid. */
  fromMs: number;
  toMs: number;
  note: string;
};

export type ManifestEntry = {
  source: SensorSource;
  kind: AnomalyKind;
  metric?: SeedMetric;
  value?: number;
  from: string;
  to: string;
  /** Rows removed (gap), replaced (outlier) or frozen (stuck). */
  rows: number;
  note: string;
};

const DAY_MS = 24 * 60 * 60_000;
const MIN_MS = 60_000;

type Template = {
  kind: AnomalyKind;
  metric?: SeedMetric;
  value?: number;
  /** How long before the end of the history the anomaly starts. */
  daysAgo: number;
  /** Length in minutes (outliers are one row). */
  minutes: number;
  note: string;
};

const TEMPLATES: Record<SensorSource, Template[]> = {
  room: [
    { kind: "gap", daysAgo: 20, minutes: 180, note: "3 hour silence" },
    { kind: "stuck", metric: "hum", daysAgo: 18, minutes: 120, note: "humidity frozen for 2 hours" },
    { kind: "outlier", metric: "hum", value: 140, daysAgo: 15, minutes: 0, note: "humidity above 100 %: physically impossible" },
    { kind: "gap", daysAgo: 12, minutes: 35, note: "35 minute silence" },
    { kind: "stuck", metric: "pm25", daysAgo: 10, minutes: 90, note: "PM2.5 frozen for 90 minutes" },
    { kind: "outlier", metric: "fusedTemp", value: 65, daysAgo: 8, minutes: 0, note: "65 degrees in a classroom" },
    { kind: "outlier", metric: "pm25", value: 950, daysAgo: 5, minutes: 0, note: "single dust spike, PM2.5" },
    { kind: "outlier", metric: "pm10", value: 980, daysAgo: 5, minutes: 0, note: "single dust spike, PM10 (same moment)" },
  ],
  street: [
    { kind: "gap", daysAgo: 25, minutes: 300, note: "5 hour silence" },
    { kind: "stuck", metric: "fusedTemp", daysAgo: 16, minutes: 180, note: "temperature frozen for 3 hours" },
    { kind: "outlier", metric: "fusedTemp", value: -60, daysAgo: 14, minutes: 0, note: "-60 degrees in Tashkent" },
    { kind: "outlier", metric: "hum", value: -10, daysAgo: 11, minutes: 0, note: "negative humidity" },
    { kind: "gap", daysAgo: 6, minutes: 40, note: "40 minute silence" },
    { kind: "outlier", metric: "mq5", value: 900, daysAgo: 4, minutes: 0, note: "gas sensor spike" },
  ],
};

/** Where the anomalies of a source go, for a history of `days` ending at `endMs` on a `stepMs` grid. */
export function planAnomalies(params: { endMs: number; stepMs: number; days: number; source: SensorSource }): AnomalyPlan[] {
  const { stepMs, days, source } = params;
  const end = Math.floor(params.endMs / stepMs) * stepMs;
  const plans: AnomalyPlan[] = [];

  for (const t of TEMPLATES[source]) {
    // Leave a day of ordinary data before the start so the defect has something to stand out against.
    if (t.daysAgo * DAY_MS > days * DAY_MS - DAY_MS) continue;
    const fromMs = end - t.daysAgo * DAY_MS;
    const steps = Math.max(1, Math.round((t.minutes * MIN_MS) / stepMs));
    plans.push({
      source,
      kind: t.kind,
      metric: t.metric,
      value: t.value,
      fromMs,
      toMs: fromMs + (steps - 1) * stepMs,
      note: t.note,
    });
  }
  return plans.sort((a, b) => a.fromMs - b.fromMs);
}

/**
 * Writes the anomalies into the rows. Returns new rows (the input is not changed) and a manifest
 * of what really changed: a plan that matches no row is not listed.
 */
export function applyAnomalies(rows: readonly SeedRow[], plans: readonly AnomalyPlan[]): { rows: SeedRow[]; manifest: ManifestEntry[] } {
  let out = rows.map((r) => ({ ...r }));
  const manifest: ManifestEntry[] = [];

  for (const plan of plans) {
    const inPlan = (r: SeedRow) => r.source === plan.source && r.recordedAt.getTime() >= plan.fromMs && r.recordedAt.getTime() <= plan.toMs;
    const touched = out.filter(inPlan);
    if (touched.length === 0) continue;

    if (plan.kind === "gap") {
      out = out.filter((r) => !inPlan(r));
    } else if (plan.kind === "outlier" && plan.metric && plan.value !== undefined) {
      for (const r of touched) r[plan.metric] = plan.value;
    } else if (plan.kind === "stuck" && plan.metric) {
      const frozen = touched[0]![plan.metric];
      if (frozen === null) continue;
      for (const r of touched) r[plan.metric] = frozen;
    } else {
      continue;
    }

    manifest.push({
      source: plan.source,
      kind: plan.kind,
      ...(plan.metric ? { metric: plan.metric } : {}),
      ...(plan.value !== undefined ? { value: plan.value } : {}),
      from: touched[0]!.recordedAt.toISOString(),
      to: touched[touched.length - 1]!.recordedAt.toISOString(),
      rows: touched.length,
      note: plan.note,
    });
  }
  return { rows: out, manifest };
}
