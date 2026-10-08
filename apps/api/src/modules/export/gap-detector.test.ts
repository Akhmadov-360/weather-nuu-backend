import { describe, expect, it } from "vitest";
import { interleaveGaps } from "./gap-detector.js";
import type { ExportRawRow } from "./export.repo.js";

async function* fakeRows(rows: ExportRawRow[]): AsyncGenerator<ExportRawRow> {
  for (const r of rows) yield r;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe("interleaveGaps", () => {
  it("yields no gap markers for an empty stream", async () => {
    expect(await collect(interleaveGaps(fakeRows([]), 15))).toEqual([]);
  });

  it("yields no gap markers when readings are within threshold", async () => {
    const rows: ExportRawRow[] = [
      { recordedAt: "2024-01-01T00:00:00.000Z", values: { temp: 1 } },
      { recordedAt: "2024-01-01T00:05:00.000Z", values: { temp: 2 } },
    ];
    const out = await collect(interleaveGaps(fakeRows(rows), 15));
    expect(out).toEqual([
      { kind: "reading", recordedAt: rows[0]!.recordedAt, values: rows[0]!.values },
      { kind: "reading", recordedAt: rows[1]!.recordedAt, values: rows[1]!.values },
    ]);
  });

  it("inserts exactly one gap marker between readings further apart than the threshold", async () => {
    const rows: ExportRawRow[] = [
      { recordedAt: "2024-01-01T00:00:00.000Z", values: { temp: 1 } },
      { recordedAt: "2024-01-01T03:00:00.000Z", values: { temp: 2 } }, // 3h gap, threshold 15min
    ];
    const out = await collect(interleaveGaps(fakeRows(rows), 15));

    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ kind: "reading", recordedAt: rows[0]!.recordedAt, values: rows[0]!.values });
    expect(out[2]).toEqual({ kind: "reading", recordedAt: rows[1]!.recordedAt, values: rows[1]!.values });

    const gap = out[1]!;
    if (gap.kind !== "gap") throw new Error("expected a gap marker");
    expect(gap.from).toBe(rows[0]!.recordedAt);
    expect(gap.to).toBe(rows[1]!.recordedAt);
    expect(gap.approxMissingReadings).toBeGreaterThan(0);
  });

  it("does not flag a gap exactly at the threshold, only strictly beyond it", async () => {
    const rows: ExportRawRow[] = [
      { recordedAt: "2024-01-01T00:00:00.000Z", values: { temp: 1 } },
      { recordedAt: "2024-01-01T00:15:00.000Z", values: { temp: 2 } }, // exactly 15min
    ];
    const out = await collect(interleaveGaps(fakeRows(rows), 15));
    expect(out.every((r) => r.kind === "reading")).toBe(true);
  });

  it("detects multiple separate gaps across a longer run", async () => {
    const rows: ExportRawRow[] = [
      { recordedAt: "2024-01-01T00:00:00.000Z", values: { temp: 1 } },
      { recordedAt: "2024-01-01T05:00:00.000Z", values: { temp: 2 } }, // gap 1
      { recordedAt: "2024-01-01T05:05:00.000Z", values: { temp: 3 } }, // no gap
      { recordedAt: "2024-01-02T05:05:00.000Z", values: { temp: 4 } }, // gap 2
    ];
    const out = await collect(interleaveGaps(fakeRows(rows), 15));
    const gaps = out.filter((r) => r.kind === "gap");
    expect(gaps).toHaveLength(2);
  });
});
