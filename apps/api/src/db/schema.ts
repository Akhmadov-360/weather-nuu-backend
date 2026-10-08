import { pgTable, serial, real, integer, varchar, timestamp, boolean, index } from "drizzle-orm/pg-core";

/**
 * Mirrors the existing `sensor_data` table (source: room|street) but the
 * old `timestamp` column was a naive DateTime — during migration it must
 * be backfilled/cast to `timestamptz` assuming the stored values are UTC
 * (that's what `datetime.utcnow` in the old backend produced). See
 * apps/api/README migration notes for the exact `ALTER TABLE` used.
 */
export const sensorData = pgTable(
  "sensor_data",
  {
    id: serial("id").primaryKey(),
    source: varchar("source", { length: 10 }).notNull(),
    hum: real("hum"),
    bmpPress: real("bmp_press"),
    mq5: integer("mq5"),
    mq3: integer("mq3"),
    fusedTemp: real("fused_temp"),
    // mode: "date" — the `pg` driver's own type parser returns a real Date
    // for timestamptz, so services get it directly instead of re-parsing
    // the raw wire string themselves (the exact class of fragile date
    // handling this rewrite exists to get rid of).
    recordedAt: timestamp("timestamp", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // True for rows written by the hourly-snapshot job (a clone of the
    // last real reading), false for genuine device POSTs. Without this,
    // the job can't tell "device went silent 3h ago" from "I cloned an
    // hour ago" — every clone would reset its own freshness clock and
    // the 3h cutoff could never actually trigger. See jobs/hourly-snapshot.ts.
    isSnapshot: boolean("is_snapshot").notNull().default(false),
  },
  (table) => ({
    // Every query in this service filters by source and ranges/sorts by time —
    // the old table had no explicit index for that, relying on the PK scan.
    sourceRecordedAtIdx: index("sensor_data_source_recorded_at_idx").on(
      table.source,
      table.recordedAt,
    ),
  }),
);

export const cansatData = pgTable(
  "cansat_data",
  {
    id: serial("id").primaryKey(),
    temp: real("temp"),
    pressure: real("pressure"),
    humidity: real("humidity"),
    accelX: real("accel_x"),
    recordedAt: timestamp("timestamp", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    recordedAtIdx: index("cansat_data_recorded_at_idx").on(table.recordedAt),
  }),
);
