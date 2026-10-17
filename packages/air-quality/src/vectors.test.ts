import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aqi, categorize, getStandard } from './index.js';
import type { CategoryId, Pollutant } from './index.js';

/**
 * Golden vectors shared with the frontend repository (weather-nuu,
 * src/shared/lib/air-quality/aqi-vectors.json). The two copies must be identical:
 * the same file is checked by the tests of both repositories, so a change in one
 * implementation that the other does not follow fails CI on that side.
 */
type Vector = { pollutant: Pollutant; value: number | null; category: CategoryId | null; aqi: number | null };
type VectorFile = { standard: string; casesSha256: string; cases: Vector[] };

const file = JSON.parse(readFileSync(new URL('../fixtures/aqi-vectors.json', import.meta.url), 'utf8')) as VectorFile;

describe('aqi-vectors.json', () => {
  it('is not empty and covers both pollutants and invalid input', () => {
    expect(file.cases.length).toBeGreaterThan(100);
    expect(new Set(file.cases.map((c) => c.pollutant))).toEqual(new Set(['pm25', 'pm10']));
    expect(file.cases.some((c) => c.value === null && c.aqi === null)).toBe(true);
  });

  it('has a hash that matches its cases (edit the cases, regenerate the hash in both repositories)', () => {
    expect(createHash('sha256').update(JSON.stringify(file.cases)).digest('hex')).toBe(file.casesSha256);
  });

  it('every vector is reproduced by the implementation', () => {
    const standard = getStandard(file.standard);
    for (const c of file.cases) {
      expect(categorize(standard, c.pollutant, c.value), `${c.pollutant} ${c.value} category`).toBe(c.category);
      expect(aqi(standard, c.pollutant, c.value), `${c.pollutant} ${c.value} aqi`).toBe(c.aqi);
    }
  });
});
