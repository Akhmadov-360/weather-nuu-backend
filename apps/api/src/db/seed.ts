import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db, pool } from "./client.js";
import { sensorData } from "./schema.js";
import { env } from "../env.js";
import type { SensorSource } from "@weather/contracts";
import { applyAnomalies, planAnomalies, type ManifestEntry, type SeedRow } from "./seed-anomalies.js";

/**
 * Fills a LOCAL database with synthetic history so the dashboard, charts and
 * export have something to show without access to the real server.
 *
 *   pnpm db:seed                 # only if sensor_data is empty
 *   pnpm db:seed --force         # wipe sensor_data and generate again
 *   pnpm db:seed --days=14       # history length (default 90)
 *   pnpm db:seed --anomalies     # also plant gaps, outliers and frozen values at KNOWN times
 *
 * Deterministic (fixed PRNG seed) so everyone sees the same curves. Each
 * source also gets one deliberate offline window, to exercise the gap
 * handling in charts and export. One reading every 5 MINUTES (the real boards send about every
 * 5 seconds): the history stays small, and code that expects a cadence takes it as a parameter.
 *
 * With --anomalies the exact times of everything planted are written to
 * apps/api/seed-anomalies.manifest.json (git-ignored), so a detection algorithm can be scored
 * against the truth. Synthetic data only: never use these curves as findings in the thesis.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db"]);

function assertLocalDatabase(): void {
  const host = new URL(env.DATABASE_URL).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    console.error(
      `Refusing to seed: DATABASE_URL host "${host}" is not a local database ` +
        `(allowed: ${[...LOCAL_HOSTS].join(", ")}). This script writes fake data and can wipe the table.`,
    );
    process.exit(1);
  }
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Profile = {
  tempMean: number;
  tempAmp: number;
  humMean: number;
  humAmp: number;
  pressMean: number;
  mq5Base: number;
  mq3Base: number;
  /** Baseline PM2.5 in µg/m³; absent for sources without a dust sensor (street). */
  dustBase?: number;
  /** Offline window ending `endsDaysAgo` days before now. */
  gap: { endsDaysAgo: number; hours: number };
};

const PROFILES: Record<SensorSource, Profile> = {
  room: {
    tempMean: 24,
    tempAmp: 1.8,
    humMean: 38,
    humAmp: 6,
    pressMean: 962,
    mq5Base: 30,
    mq3Base: 3,
    dustBase: 14,
    gap: { endsDaysAgo: 9, hours: 10 },
  },
  street: {
    tempMean: 17,
    tempAmp: 7,
    humMean: 45,
    humAmp: 18,
    pressMean: 962,
    mq5Base: 22,
    mq3Base: 2,
    gap: { endsDaysAgo: 2, hours: 6 },
  },
};

const STEP_MS = 5 * 60_000;
const BATCH_SIZE = 1000;
const DEFAULT_DAYS = 90;
const MANIFEST_PATH = fileURLToPath(new URL("../../seed-anomalies.manifest.json", import.meta.url));
const DAY_MS = 24 * 60 * 60_000;

function generate(source: SensorSource, days: number, now: number, rand: () => number): SeedRow[] {
  const p = PROFILES[source];
  const end = Math.floor(now / STEP_MS) * STEP_MS;
  const start = end - days * DAY_MS;
  const gapEnd = end - p.gap.endsDaysAgo * DAY_MS;
  const gapStart = gapEnd - p.gap.hours * 60 * 60_000;

  const rows: SeedRow[] = [];
  for (let t = start; t <= end; t += STEP_MS) {
    if (t >= gapStart && t < gapEnd) continue;

    const date = new Date(t);
    const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
    const phase = (2 * Math.PI * (hour - 4)) / 24; // daily peak around 10:00 UTC
    const daily = Math.sin(phase);
    const slow = Math.sin((2 * Math.PI * (t - start)) / (9 * DAY_MS));

    const temp = p.tempMean + p.tempAmp * daily + 1.2 * slow + (rand() - 0.5) * 0.3;
    const hum = p.humMean - p.humAmp * daily + 4 * slow + (rand() - 0.5) * 1.5;
    const press = p.pressMean + 4 * Math.sin((2 * Math.PI * (t - start)) / (3.5 * DAY_MS)) + (rand() - 0.5) * 0.4;
    const spike = rand() < 0.01 ? rand() * 40 : 0;
    const mq5 = Math.round(p.mq5Base + 6 * Math.max(0, daily) + spike + (rand() - 0.5) * 4);
    const mq3 = Math.max(0, Math.round(p.mq3Base + (rand() - 0.5) * 3));

    // Dust: a daily rhythm plus a slow "smoggy days" episode every ~11 days,
    // so the map/charts show several AQI categories, not one flat colour.
    let pm25: number | null = null;
    let pm10: number | null = null;
    if (p.dustBase !== undefined) {
      const episode = Math.max(0, Math.sin((2 * Math.PI * (t - start)) / (11 * DAY_MS)));
      const dust = p.dustBase * (1 + 2.2 * episode) + 3 * daily + (rand() - 0.5) * 4;
      pm25 = Math.max(1, Math.round(dust));
      pm10 = Math.max(pm25, Math.round(pm25 * 1.6 + (rand() - 0.5) * 6));
    }

    rows.push({
      source,
      fusedTemp: Math.round(temp * 100) / 100,
      hum: Math.round(hum * 10) / 10,
      bmpPress: Math.round(press * 100) / 100,
      mq5: Math.max(0, mq5),
      mq3,
      pm25,
      pm10,
      recordedAt: date,
    });
  }
  return rows;
}

async function main() {
  assertLocalDatabase();

  const force = process.argv.includes("--force");
  const withAnomalies = process.argv.includes("--anomalies");
  const days = Number(argValue("days") ?? DEFAULT_DAYS);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    console.error("--days must be a number between 1 and 365");
    process.exit(1);
  }

  const existing = await pool.query<{ n: string }>("SELECT count(*) AS n FROM sensor_data");
  const count = Number(existing.rows[0]!.n);

  if (count > 0 && !force) {
    console.log(`sensor_data already has ${count} rows — skipping seed (use --force to regenerate).`);
    await pool.end();
    return;
  }
  if (force) {
    await pool.query("TRUNCATE sensor_data RESTART IDENTITY");
  }

  const rand = mulberry32(42);
  const now = Date.now();
  let total = 0;

  const manifest: ManifestEntry[] = [];

  for (const source of ["room", "street"] as const) {
    let rows = generate(source, days, now, rand);
    if (withAnomalies) {
      const planned = planAnomalies({ endMs: now, stepMs: STEP_MS, days, source });
      const applied = applyAnomalies(rows, planned);
      rows = applied.rows;
      manifest.push(...applied.manifest);
    }
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await db.insert(sensorData).values(rows.slice(i, i + BATCH_SIZE));
    }
    total += rows.length;
    console.log(`seeded ${rows.length} rows for "${source}"`);
  }

  if (withAnomalies) {
    writeFileSync(MANIFEST_PATH, JSON.stringify({ generatedAt: new Date(now).toISOString(), stepMinutes: STEP_MS / 60_000, anomalies: manifest }, null, 2) + "\n");
    console.log(`planted ${manifest.length} anomalies, list: ${MANIFEST_PATH}`);
  }

  console.log(`Done: ${total} rows, ${days} days of history ending now.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
