import { and, asc, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { db as Db } from "../../db/client.js";
import { sensorData } from "../../db/schema.js";
import type { SensorSource } from "@weather/contracts";
import type { PageCursor } from "../../lib/cursor.js";
import { keysetCursorCondition } from "../../lib/keyset.js";

export type SensorRow = typeof sensorData.$inferSelect;

export class SensorsRepo {
  constructor(private readonly db: typeof Db) {}

  async findLatest(source: SensorSource): Promise<SensorRow | undefined> {
    const [row] = await this.db
      .select()
      .from(sensorData)
      .where(eq(sensorData.source, source))
      .orderBy(desc(sensorData.recordedAt), desc(sensorData.id))
      .limit(1);
    return row;
  }

  /** Like findLatest, but only counts genuine device rows — used by the
   *  hourly-snapshot job to measure real silence, not its own clones. */
  async findLatestReal(source: SensorSource): Promise<SensorRow | undefined> {
    const [row] = await this.db
      .select()
      .from(sensorData)
      .where(and(eq(sensorData.source, source), eq(sensorData.isSnapshot, false)))
      .orderBy(desc(sensorData.recordedAt), desc(sensorData.id))
      .limit(1);
    return row;
  }

  /** Keyset pagination — see lib/keyset.ts for why the cursor is (recordedAt, id). */
  async findPage(params: {
    source: SensorSource;
    from?: string;
    to?: string;
    cursor?: PageCursor;
    limit: number;
  }): Promise<SensorRow[]> {
    const conditions: SQL[] = [eq(sensorData.source, params.source)];

    if (params.cursor) {
      conditions.push(
        keysetCursorCondition(sensorData.recordedAt, sensorData.id, {
          recordedAt: new Date(params.cursor.recordedAt),
          id: params.cursor.id,
        }),
      );
    } else if (params.from) {
      conditions.push(gte(sensorData.recordedAt, new Date(params.from)));
    }
    if (params.to) conditions.push(lte(sensorData.recordedAt, new Date(params.to)));

    return this.db
      .select()
      .from(sensorData)
      .where(and(...conditions))
      .orderBy(asc(sensorData.recordedAt), asc(sensorData.id))
      .limit(params.limit);
  }

  async insert(source: SensorSource, values: Partial<SensorRow>): Promise<SensorRow> {
    const [row] = await this.db
      .insert(sensorData)
      .values({ source, ...values })
      .returning();
    if (!row) throw new Error("insert into sensor_data returned no row");
    return row;
  }

  async bounds(source: SensorSource): Promise<{ earliest?: Date; latest?: Date; total: number }> {
    const [row] = await this.db
      .select()
      .from(sensorData)
      .where(eq(sensorData.source, source))
      .orderBy(asc(sensorData.recordedAt))
      .limit(1);
    const [last] = await this.db
      .select()
      .from(sensorData)
      .where(eq(sensorData.source, source))
      .orderBy(desc(sensorData.recordedAt))
      .limit(1);
    const count = await this.db.$count(sensorData, eq(sensorData.source, source));
    return { earliest: row?.recordedAt, latest: last?.recordedAt, total: count };
  }
}
