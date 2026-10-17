import type { Breakpoint, CategoryId, Pollutant, Standard } from './types.js';

/**
 * Floor, not round: EPA truncates PM2.5 to one decimal (PM10 to an integer)
 * before looking up the category. The epsilon absorbs binary-float error so
 * values written as exact decimals (35.4, 0.3, 125.4) are not floored one
 * step too low.
 */
function truncate(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 1e-9) / factor;
}

function isUsable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** The table row for a truncated concentration; above the table, the last row. */
function findRow(rows: Breakpoint[], truncated: number): Breakpoint {
  return rows.find((row) => truncated >= row.cLow && truncated <= row.cHigh) ?? rows[rows.length - 1]!;
}

export function categorize(
  standard: Standard,
  pollutant: Pollutant,
  value: number | null | undefined,
): CategoryId | null {
  if (!isUsable(value)) return null;
  const truncated = truncate(value, standard.decimals[pollutant]);
  return findRow(standard.breakpoints[pollutant], truncated).category;
}

export function aqi(
  standard: Standard,
  pollutant: Pollutant,
  value: number | null | undefined,
): number | null {
  if (!isUsable(value)) return null;
  const rows = standard.breakpoints[pollutant];
  const last = rows[rows.length - 1]!;
  const truncated = truncate(value, standard.decimals[pollutant]);
  if (truncated > last.cHigh) return last.aqiHigh;

  const row = findRow(rows, truncated);
  const slope = (row.aqiHigh - row.aqiLow) / (row.cHigh - row.cLow);
  return Math.min(last.aqiHigh, Math.round(slope * (truncated - row.cLow) + row.aqiLow));
}
