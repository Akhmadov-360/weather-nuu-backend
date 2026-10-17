import cron from "node-cron";
import type { FastifyInstance } from "fastify";
import { SensorsRepo } from "../modules/sensors/sensors.repo.js";
import type { SensorSource } from "@weather/contracts";

const SOURCES: SensorSource[] = ["room", "street"];

/** Beyond this, stop manufacturing continuity — a real gap should show up
 *  in the data instead of an indefinitely-cloned flat line. Matches the
 *  product call: brief connectivity blips get smoothed over, a genuinely
 *  offline sensor (device down, room empty over summer, ...) does not. */
const MAX_SNAPSHOT_GAP_MS = 3 * 60 * 60 * 1000;

/**
 * Once an hour, if the device has posted for real within the last 3h,
 * duplicate its latest reading so the history table keeps ~hourly
 * resolution through brief gaps instead of a multi-hour flat stretch from
 * missing writes alone. Past 3h of real silence, this stops entirely —
 * the resulting gap in `recordedAt` is what lets the frontend (staleness
 * heuristic) and the chart (interleaveGaps-style break) tell "sensor
 * genuinely offline" from "just a normal quiet moment between pushes".
 *
 * Cloned rows are marked `isSnapshot: true` specifically so this decision
 * is based on the last REAL row, not on a clone from an hour ago — without
 * that distinction every clone would reset its own freshness clock and
 * the cap could never trigger.
 */
export function registerHourlySnapshot(app: FastifyInstance) {
  const repo = new SensorsRepo(app.db);

  const task = cron.schedule(
    "0 * * * *",
    async () => {
      for (const source of SOURCES) {
        try {
          const lastReal = await repo.findLatestReal(source);
          if (!lastReal) continue;

          const silentForMs = Date.now() - lastReal.recordedAt.getTime();
          if (silentForMs > MAX_SNAPSHOT_GAP_MS) {
            app.log.info({ source, silentForMs }, "device silent past snapshot cap — not cloning");
            continue;
          }

          await repo.insert(source, {
            hum: lastReal.hum,
            bmpPress: lastReal.bmpPress,
            mq5: lastReal.mq5,
            mq3: lastReal.mq3,
            fusedTemp: lastReal.fusedTemp,
            pm25: lastReal.pm25,
            pm10: lastReal.pm10,
            isSnapshot: true,
          });
        } catch (err) {
          app.log.error({ err, source }, "hourly snapshot failed");
        }
      }
    },
    // node-cron runs on the host's local timezone by default; the old
    // APScheduler job pinned this explicitly (`timezone="UTC"`) so "top of
    // the hour" always means UTC regardless of what OS the container runs
    // on — matching that here, not the server's local clock.
    { timezone: "UTC" },
  );

  // Without this the schedule outlives the app (tests that build and close the app would leave it running).
  app.addHook("onClose", async () => {
    task.stop();
  });
}
