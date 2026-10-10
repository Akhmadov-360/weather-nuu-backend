/**
 * Cleans the dust-sensor values coming from the Room firmware before they
 * reach the database.
 *
 * The sketch initialises `pm25_val = pm10_val = 0` and only overwrites them
 * when the PMS sensor answers (`pms.readUntil`). When the read fails — sensor
 * still warming up, UART hiccup — it posts `0`/`0` anyway. Storing those as
 * real readings would drag every average and chart towards zero, so a 0/0
 * pair is treated as "no reading" (NULL). A genuine 0/0 would mean perfectly
 * dust-free air, which this sensor effectively never reports.
 *
 * The PMS5003 measures 0-1000 µg/m³; anything outside that, or non-numeric,
 * is dropped per value rather than failing the whole request, so the other
 * sensors in the same POST are still saved.
 */
const PM_MAX = 1000;

export type PmValues = { pm25: number | null; pm10: number | null };

function sanitize(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  if (value < 0 || value > PM_MAX) return null;
  return Math.round(value);
}

export function normalizePm(pm25: number | undefined, pm10: number | undefined): PmValues {
  if (pm25 === 0 && pm10 === 0) return { pm25: null, pm10: null };
  return { pm25: sanitize(pm25), pm10: sanitize(pm10) };
}
