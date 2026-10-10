import type { ExportMeta, ExportQuery, ExportRow, ExportSource } from "@weather/contracts";
import type { db as Db } from "../../db/client.js";
import { streamRows } from "./export.repo.js";
import { interleaveGaps } from "./gap-detector.js";
import type { SensorsRepo } from "../sensors/sensors.repo.js";
import type { CansatRepo } from "../cansat/cansat.repo.js";

export const EXPORT_COLUMNS: Record<ExportSource, string[]> = {
  // Only Room has the dust sensor; street columns stay as they were so its
  // exports don't gain two permanently empty columns.
  room: ["hum", "bmpPress", "mq5", "mq3", "fusedTemp", "pm25", "pm10"],
  street: ["hum", "bmpPress", "mq5", "mq3", "fusedTemp"],
  cansat: ["temp", "pressure", "humidity", "accelX"],
};

export class ExportService {
  constructor(
    private readonly db: typeof Db,
    private readonly sensorsRepo: SensorsRepo,
    private readonly cansatRepo: CansatRepo,
  ) {}

  /**
   * Real readings interleaved with explicit gap markers — see
   * gap-detector.ts. This is what lets a "sensor was unplugged for 3 days"
   * period show up as a clearly-labelled gap in the export instead of
   * silently interpolating or looking like the sensor just stopped
   * mid-file with no explanation.
   */
  stream(source: ExportSource, query: ExportQuery): AsyncGenerator<ExportRow> {
    return interleaveGaps(streamRows(this.db, source, { from: query.from, to: query.to }), query.gapThresholdMinutes);
  }

  async meta(source: ExportSource): Promise<ExportMeta> {
    const bounds = source === "cansat" ? await this.cansatRepo.bounds() : await this.sensorsRepo.bounds(source);
    return {
      source,
      earliestRecordedAt: bounds.earliest ? bounds.earliest.toISOString() : null,
      latestRecordedAt: bounds.latest ? bounds.latest.toISOString() : null,
      totalCount: bounds.total,
    };
  }
}
