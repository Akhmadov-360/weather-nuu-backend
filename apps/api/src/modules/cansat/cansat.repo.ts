import { and, asc, desc, gte, lte, type SQL } from "drizzle-orm";
import type { db as Db } from "../../db/client.js";
import { cansatData } from "../../db/schema.js";
import type { PageCursor } from "../../lib/cursor.js";
import { keysetCursorCondition } from "../../lib/keyset.js";

export type CansatRow = typeof cansatData.$inferSelect;

export class CansatRepo {
  constructor(private readonly db: typeof Db) {}

  async findLatest(): Promise<CansatRow | undefined> {
    const [row] = await this.db
      .select()
      .from(cansatData)
      .orderBy(desc(cansatData.recordedAt), desc(cansatData.id))
      .limit(1);
    return row;
  }

  /** See SensorsRepo.findPage / lib/keyset.ts — same (recordedAt, id) composite cursor, same reason. */
  async findPage(params: { from?: string; to?: string; cursor?: PageCursor; limit: number }): Promise<CansatRow[]> {
    const conditions: SQL[] = [];

    if (params.cursor) {
      conditions.push(
        keysetCursorCondition(cansatData.recordedAt, cansatData.id, {
          recordedAt: new Date(params.cursor.recordedAt),
          id: params.cursor.id,
        }),
      );
    } else if (params.from) {
      conditions.push(gte(cansatData.recordedAt, new Date(params.from)));
    }
    if (params.to) conditions.push(lte(cansatData.recordedAt, new Date(params.to)));

    return this.db
      .select()
      .from(cansatData)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(cansatData.recordedAt), asc(cansatData.id))
      .limit(params.limit);
  }

  async insert(values: Partial<CansatRow>): Promise<CansatRow> {
    const [row] = await this.db.insert(cansatData).values(values).returning();
    if (!row) throw new Error("insert into cansat_data returned no row");
    return row;
  }

  async bounds(): Promise<{ earliest?: Date; latest?: Date; total: number }> {
    const [first] = await this.db.select().from(cansatData).orderBy(asc(cansatData.recordedAt)).limit(1);
    const [last] = await this.db.select().from(cansatData).orderBy(desc(cansatData.recordedAt)).limit(1);
    const total = await this.db.$count(cansatData);
    return { earliest: first?.recordedAt, latest: last?.recordedAt, total };
  }
}
