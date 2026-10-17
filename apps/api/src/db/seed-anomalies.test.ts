import { describe, expect, it } from "vitest";
import { applyAnomalies, planAnomalies, type SeedRow } from "./seed-anomalies.js";

const STEP = 5 * 60_000;
const DAY = 24 * 60 * 60_000;
const END = Date.UTC(2026, 9, 20, 12, 0, 0); // aligned to the 5-minute step

function rowsFor(source: "room" | "street", days: number): SeedRow[] {
  const rows: SeedRow[] = [];
  for (let t = END - days * DAY; t <= END; t += STEP) {
    rows.push({
      source,
      recordedAt: new Date(t),
      fusedTemp: 20,
      hum: 40 + (t % 7),
      bmpPress: 960,
      mq5: 30,
      mq3: 3,
      pm25: source === "room" ? 14 : null,
      pm10: source === "room" ? 22 : null,
    });
  }
  return rows;
}

describe("planAnomalies", () => {
  it("is deterministic", () => {
    expect(planAnomalies({ endMs: END, stepMs: STEP, days: 90, source: "room" })).toEqual(
      planAnomalies({ endMs: END, stepMs: STEP, days: 90, source: "room" }),
    );
  });

  it("places every anomaly inside the generated range, on the step grid, oldest first", () => {
    for (const source of ["room", "street"] as const) {
      const plans = planAnomalies({ endMs: END, stepMs: STEP, days: 90, source });
      expect(plans.length).toBeGreaterThan(3);
      for (const p of plans) {
        expect(p.fromMs).toBeGreaterThanOrEqual(END - 90 * DAY);
        expect(p.toMs).toBeLessThanOrEqual(END);
        expect(p.fromMs % STEP).toBe(0);
        expect(p.toMs).toBeGreaterThanOrEqual(p.fromMs);
      }
      expect(plans.map((p) => p.fromMs)).toEqual([...plans.map((p) => p.fromMs)].sort((a, b) => a - b));
    }
  });

  it("covers gaps, outliers and stuck stretches", () => {
    const kinds = new Set(planAnomalies({ endMs: END, stepMs: STEP, days: 90, source: "room" }).map((p) => p.kind));
    expect(kinds).toEqual(new Set(["gap", "outlier", "stuck"]));
  });

  it("gives only the room dust anomalies (the street has no dust sensor)", () => {
    const dust = (s: "room" | "street") =>
      planAnomalies({ endMs: END, stepMs: STEP, days: 90, source: s }).filter((p) => p.metric === "pm25" || p.metric === "pm10");
    expect(dust("room").length).toBeGreaterThan(0);
    expect(dust("street")).toEqual([]);
  });

  it("drops the anomalies that do not fit a short history", () => {
    const short = planAnomalies({ endMs: END, stepMs: STEP, days: 7, source: "room" });
    expect(short.every((p) => p.fromMs >= END - 7 * DAY)).toBe(true);
    expect(short.length).toBeLessThan(planAnomalies({ endMs: END, stepMs: STEP, days: 90, source: "room" }).length);
  });

  it("never overlaps two anomalies of the same metric", () => {
    const plans = planAnomalies({ endMs: END, stepMs: STEP, days: 90, source: "room" });
    const byKey = new Map<string, { fromMs: number; toMs: number }[]>();
    for (const p of plans) {
      const key = p.kind === "gap" ? "gap" : p.metric!;
      byKey.set(key, [...(byKey.get(key) ?? []), p]);
    }
    for (const list of byKey.values()) {
      const sorted = [...list].sort((a, b) => a.fromMs - b.fromMs);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.fromMs).toBeGreaterThan(sorted[i - 1]!.toMs);
    }
  });
});

describe("applyAnomalies", () => {
  const plan = (over: Partial<Parameters<typeof applyAnomalies>[1][number]>) => ({
    source: "room" as const,
    kind: "gap" as const,
    fromMs: END - 2 * DAY,
    toMs: END - 2 * DAY + 3 * 60 * 60_000 - STEP,
    note: "",
    ...over,
  });

  it("removes the rows of a gap and nothing else", () => {
    const rows = rowsFor("room", 5);
    const { rows: out, manifest } = applyAnomalies(rows, [plan({})]);
    expect(out.length).toBe(rows.length - 36); // 3 h at 5 minutes
    expect(manifest[0]).toMatchObject({ kind: "gap", rows: 36 });
    expect(manifest[0]!.from).toBe(new Date(END - 2 * DAY).toISOString());
  });

  it("replaces one value of one row for an outlier and leaves the other metrics alone", () => {
    const rows = rowsFor("room", 5);
    const at = END - 3 * DAY;
    const { rows: out, manifest } = applyAnomalies(rows, [plan({ kind: "outlier", metric: "hum", value: 140, fromMs: at, toMs: at })]);
    const hit = out.find((r) => r.recordedAt.getTime() === at)!;
    expect(hit.hum).toBe(140);
    expect(hit.fusedTemp).toBe(20);
    expect(out.filter((r) => r.hum === 140)).toHaveLength(1);
    expect(manifest[0]).toMatchObject({ kind: "outlier", metric: "hum", rows: 1 });
  });

  it("holds one metric at its starting value for a stuck stretch while the others keep changing", () => {
    const rows = rowsFor("room", 5);
    const from = END - 3 * DAY;
    const to = from + 2 * 60 * 60_000 - STEP;
    const startValue = rows.find((r) => r.recordedAt.getTime() === from)!.hum;
    const { rows: out, manifest } = applyAnomalies(rows, [plan({ kind: "stuck", metric: "hum", fromMs: from, toMs: to })]);
    const stretch = out.filter((r) => r.recordedAt.getTime() >= from && r.recordedAt.getTime() <= to);
    expect(stretch).toHaveLength(24);
    expect(new Set(stretch.map((r) => r.hum))).toEqual(new Set([startValue]));
    expect(manifest[0]).toMatchObject({ kind: "stuck", metric: "hum", rows: 24 });
  });

  it("does not touch rows of another source and does not change its input", () => {
    const rows = rowsFor("street", 5);
    const copy = rows.map((r) => ({ ...r }));
    const { rows: out, manifest } = applyAnomalies(rows, [plan({ source: "room" })]);
    expect(out).toEqual(copy);
    expect(manifest).toEqual([]);
    expect(rows).toEqual(copy);
  });

  it("reports in the manifest only what was really changed (a plan outside the data counts nothing)", () => {
    const rows = rowsFor("room", 5);
    const { manifest } = applyAnomalies(rows, [plan({ fromMs: END - 40 * DAY, toMs: END - 40 * DAY })]);
    expect(manifest).toEqual([]);
  });
});
