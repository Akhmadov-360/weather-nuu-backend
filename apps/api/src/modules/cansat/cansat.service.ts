import { AppError, type CansatReading, type CansatReadingInput } from "@weather/contracts";
import type { CansatRepo, CansatRow } from "./cansat.repo.js";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";

function toDto(row: CansatRow): CansatReading {
  return {
    id: row.id,
    temp: row.temp,
    pressure: row.pressure,
    humidity: row.humidity,
    accelX: row.accelX,
    recordedAt: row.recordedAt.toISOString(),
  };
}

export class CansatService {
  constructor(private readonly repo: CansatRepo) {}

  async ingest(input: CansatReadingInput): Promise<CansatReading> {
    const row = await this.repo.insert({
      temp: input.temp ?? null,
      pressure: input.pressure ?? null,
      humidity: input.humidity ?? null,
      accelX: input.accelX ?? null,
    });
    return toDto(row);
  }

  async latest(): Promise<CansatReading> {
    const row = await this.repo.findLatest();
    if (!row) throw AppError.notFound("No cansat readings yet");
    return toDto(row);
  }

  async history(params: { from?: string; to?: string; cursor?: string; limit: number }) {
    const cursor = params.cursor ? decodeCursor(params.cursor) : undefined;
    const rows = await this.repo.findPage({ from: params.from, to: params.to, cursor, limit: params.limit });
    const items = rows.map(toDto);
    const lastRow = rows[rows.length - 1];
    const nextCursor =
      rows.length === params.limit && lastRow
        ? encodeCursor({ recordedAt: lastRow.recordedAt.toISOString(), id: lastRow.id })
        : null;
    return { items, nextCursor };
  }
}
