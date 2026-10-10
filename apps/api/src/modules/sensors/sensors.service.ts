import { AppError, type SensorReading, type SensorReadingInput, type SensorSource } from "@weather/contracts";
import type { SensorsRepo, SensorRow } from "./sensors.repo.js";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";
import { normalizePm } from "./pm.js";

function toDto(row: SensorRow): SensorReading {
  return {
    id: row.id,
    source: row.source as SensorSource,
    hum: row.hum,
    bmpPress: row.bmpPress,
    mq5: row.mq5,
    mq3: row.mq3,
    fusedTemp: row.fusedTemp,
    pm25: row.pm25,
    pm10: row.pm10,
    recordedAt: row.recordedAt.toISOString(),
  };
}

export class SensorsService {
  constructor(private readonly repo: SensorsRepo) {}

  async ingest(source: SensorSource, input: SensorReadingInput): Promise<SensorReading> {
    const { pm25, pm10 } = normalizePm(input.pm25, input.pm10);
    const row = await this.repo.insert(source, {
      hum: input.hum ?? null,
      bmpPress: input.bmpPress ?? null,
      mq5: input.mq5 ?? null,
      mq3: input.mq3 ?? null,
      fusedTemp: input.fusedTemp ?? null,
      pm25,
      pm10,
    });
    return toDto(row);
  }

  async latest(source: SensorSource): Promise<SensorReading> {
    const row = await this.repo.findLatest(source);
    if (!row) throw AppError.notFound(`No readings for source "${source}" yet`);
    return toDto(row);
  }

  async history(params: {
    source: SensorSource;
    from?: string;
    to?: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: SensorReading[]; nextCursor: string | null }> {
    const cursor = params.cursor ? decodeCursor(params.cursor) : undefined;
    const rows = await this.repo.findPage({
      source: params.source,
      from: params.from,
      to: params.to,
      cursor,
      limit: params.limit,
    });
    const items = rows.map(toDto);
    const lastRow = rows[rows.length - 1];
    const nextCursor =
      rows.length === params.limit && lastRow
        ? encodeCursor({ recordedAt: lastRow.recordedAt.toISOString(), id: lastRow.id })
        : null;
    return { items, nextCursor };
  }
}
