import { and, eq, gt, or, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * Shared by sensors/cansat/export repos: a `recordedAt` cursor alone can
 * skip rows tied at the exact boundary value, since `gt(recordedAt, x)`
 * excludes everything at `x` — including rows that never made it into a
 * page. Ordering and filtering by (recordedAt, id) together guarantees
 * every row is visited exactly once, however many share a timestamp.
 */
export function keysetCursorCondition(
  recordedAtColumn: AnyColumn,
  idColumn: AnyColumn,
  cursor: { recordedAt: Date; id: number },
): SQL {
  return or(
    gt(recordedAtColumn, cursor.recordedAt),
    and(eq(recordedAtColumn, cursor.recordedAt), gt(idColumn, cursor.id)),
  )!;
}
