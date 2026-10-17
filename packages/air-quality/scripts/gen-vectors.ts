/**
 * Regenerates fixtures/aqi-vectors.json from the implementation. Run it only after a deliberate
 * change of a standard's table or of the calculation rules, review the diff against the official
 * table, then copy the file to the frontend repository (src/shared/lib/air-quality/aqi-vectors.json).
 * Usage: pnpm vectors
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { aqi, categorize } from '../src/calc.js';
import { US_EPA_2024 as S } from '../src/standards/us-epa-2024.js';

const cases: unknown[] = [];
for (const pollutant of ['pm25', 'pm10'] as const) {
  const d = S.decimals[pollutant];
  const step = 10 ** -d;
  const fix = (v: number) => Number(v.toFixed(d + 2));
  const values = new Set<number>([0, fix(0.5 * step)]);
  for (const row of S.breakpoints[pollutant]) {
    values.add(row.cLow);
    values.add(fix(row.cLow + step));
    values.add(fix(row.cLow + (row.cHigh - row.cLow) / 4));
    values.add(fix(row.cLow + (3 * (row.cHigh - row.cLow)) / 4));
    values.add(fix(row.cHigh - step));
    values.add(fix((row.cLow + row.cHigh) / 2));
    values.add(row.cHigh);
    values.add(fix(row.cHigh + 0.9 * step)); // truncates back into this row
    values.add(fix(row.cHigh + step)); // first value of the next row (or beyond the table)
  }
  const last = S.breakpoints[pollutant].at(-1)!;
  values.add(last.cHigh + 1);
  values.add(1000);
  for (const value of [...values].sort((a, b) => a - b)) {
    cases.push({ pollutant, value, category: categorize(S, pollutant, value), aqi: aqi(S, pollutant, value) });
  }
  for (const value of [null, -0.1, -1]) cases.push({ pollutant, value, category: null, aqi: null });
}
const casesSha256 = createHash('sha256').update(JSON.stringify(cases)).digest('hex');
const out = { standard: S.id, casesSha256, cases };
const json = JSON.stringify(out, null, 1).replace(/\n\s+\{\n\s+"pollutant": "(\w+)",\n\s+"value": ([^\n]+),\n\s+"category": ([^\n]+),\n\s+"aqi": ([^\n]+)\n\s+\}/g, '\n  {"pollutant": "$1", "value": $2, "category": $3, "aqi": $4}');
writeFileSync(new URL("../fixtures/aqi-vectors.json", import.meta.url), json + '\n');
console.log(cases.length, casesSha256);
