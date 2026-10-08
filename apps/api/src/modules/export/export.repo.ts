import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { db as Db } from "../../db/client.js";
import { sensorData, cansatData } from "../../db/schema.js";
import type { ExportSource } from "@weather/contracts";
import { keysetCursorCondition } from "../../lib/keyset.js";

const PAGE_SIZE = 5000;

export type ExportRawRow = {
  recordedAt: string;
  values: Record<string, number | null>;
};

type PageRow = ExportRawRow & { id: number };

/** Internal-only cursor — never serialized, lives for the duration of one streamRows() call. */
type Cursor = { recordedAt: string; id: number };

/**
 * Streams every row for a source/range as an async generator, paging
 * through the table with keyset pagination — ordered by (recordedAt, id),
 * not `recordedAt` alone, since several rows can share a timestamp and a
 * single-column cursor can permanently skip whatever doesn't fit in the
 * page at that exact boundary value. This is what makes "export
 * everything since day one" both memory-safe and complete.
 */
export async function* streamRows(
  db: typeof Db,
  source: ExportSource,
  range: { from?: string; to?: string },
): AsyncGenerator<ExportRawRow> {
  let cursor: Cursor | undefined;
  let from = range.from;

  while (true) {
    const rows: PageRow[] =
      source === "cansat"
        ? await fetchCansatPage(db, { from, to: range.to, cursor })
        : await fetchSensorPage(db, source, { from, to: range.to, cursor });

    if (rows.length === 0) return;
    for (const row of rows) yield { recordedAt: row.recordedAt, values: row.values };

    const last = rows[rows.length - 1]!;
    cursor = { recordedAt: last.recordedAt, id: last.id };
    from = undefined; // cursor drives filtering from here on, not `from`
    if (rows.length < PAGE_SIZE) return;
  }
}

async function fetchSensorPage(
  db: typeof Db,
  source: "room" | "street",
  page: { from?: string; to?: string; cursor?: Cursor },
): Promise<PageRow[]> {
  const conditions: SQL[] = [eq(sensorData.source, source)];
  if (page.cursor) {
    conditions.push(
      keysetCursorCondition(sensorData.recordedAt, sensorData.id, {
        recordedAt: new Date(page.cursor.recordedAt),
        id: page.cursor.id,
      }),
    );
  } else if (page.from) {
    conditions.push(gte(sensorData.recordedAt, new Date(page.from)));
  }
  if (page.to) conditions.push(lte(sensorData.recordedAt, new Date(page.to)));

  const rows = await db
    .select()
    .from(sensorData)
    .where(and(...conditions))
    .orderBy(asc(sensorData.recordedAt), asc(sensorData.id))
    .limit(PAGE_SIZE);

  return rows.map((r) => ({
    id: r.id,
    recordedAt: r.recordedAt.toISOString(),
    values: { hum: r.hum, bmpPress: r.bmpPress, mq5: r.mq5, mq3: r.mq3, fusedTemp: r.fusedTemp },
  }));
}

async function fetchCansatPage(
  db: typeof Db,
  page: { from?: string; to?: string; cursor?: Cursor },
): Promise<PageRow[]> {
  const conditions: SQL[] = [];
  if (page.cursor) {
    conditions.push(
      keysetCursorCondition(cansatData.recordedAt, cansatData.id, {
        recordedAt: new Date(page.cursor.recordedAt),
        id: page.cursor.id,
      }),
    );
  } else if (page.from) {
    conditions.push(gte(cansatData.recordedAt, new Date(page.from)));
  }
  if (page.to) conditions.push(lte(cansatData.recordedAt, new Date(page.to)));

  const rows = await db
    .select()
    .from(cansatData)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(cansatData.recordedAt), asc(cansatData.id))
    .limit(PAGE_SIZE);

  return rows.map((r) => ({
    id: r.id,
    recordedAt: r.recordedAt.toISOString(),
    values: { temp: r.temp, pressure: r.pressure, humidity: r.humidity, accelX: r.accelX },
  }));
}
