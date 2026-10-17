import type { ExportRow } from "@weather/contracts";
import { gapBetween } from "@weather/timeseries";
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
      const gap = gapBetween(new Date(previous).getTime(), new Date(row.recordedAt).getTime(), { thresholdMs });
      if (gap) {
        yield { kind: "gap", from: previous, to: row.recordedAt, approxMissingReadings: gap.approxMissing };
      }
    }
    yield { kind: "reading", recordedAt: row.recordedAt, values: row.values };
    previous = row.recordedAt;
  }
}
