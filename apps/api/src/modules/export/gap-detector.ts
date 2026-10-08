import type { ExportRow } from "@weather/contracts";
import type { ExportRawRow } from "./export.repo.js";

/**
 * Interleaves explicit gap markers between readings whenever two
 * consecutive ones are further apart than `gapThresholdMinutes`. Pulled
 * out of ExportService as a pure function (no DB) so the tie-break/edge
 * cases here — first row, empty stream, exact-threshold boundary — can be
 * unit tested directly instead of only through a live database.
 */
export async function* interleaveGaps(
  rows: AsyncIterable<ExportRawRow>,
  gapThresholdMinutes: number,
): AsyncGenerator<ExportRow> {
  const thresholdMs = gapThresholdMinutes * 60_000;
  let previous: string | undefined;

  for await (const row of rows) {
    if (previous) {
      const gapMs = new Date(row.recordedAt).getTime() - new Date(previous).getTime();
      if (gapMs > thresholdMs) {
        yield {
          kind: "gap",
          from: previous,
          to: row.recordedAt,
          approxMissingReadings: Math.max(0, Math.round(gapMs / thresholdMs) - 1),
        };
      }
    }
    yield { kind: "reading", recordedAt: row.recordedAt, values: row.values };
    previous = row.recordedAt;
  }
}
