import { describe, expect, it } from 'vitest';
import { aqi, categorize } from './calc.js';
import { US_EPA_2024 as S } from './standards/us-epa-2024.js';
import type { CategoryId } from './types.js';

describe('PM2.5 under US EPA 2024', () => {
  it.each([
    [0, 'good', 0],
    [9.0, 'good', 50],
    [9.09, 'good', 50],
    [9.1, 'moderate', 51],
    [35.49, 'moderate', 100],
    [35.5, 'unhealthy_sensitive', 101],
    [55.4, 'unhealthy_sensitive', 150],
    [55.5, 'unhealthy', 151],
    [125.4, 'unhealthy', 200],
    [125.5, 'very_unhealthy', 201],
    [225.4, 'very_unhealthy', 300],
    [225.5, 'hazardous', 301],
    [325.4, 'hazardous', 500],
    [325.5, 'hazardous', 500],
    [1000, 'hazardous', 500],
  ] as [number, CategoryId, number][])('%s µg/m³ → %s, AQI %s', (value, category, index) => {
    expect(categorize(S, 'pm25', value)).toBe(category);
    expect(aqi(S, 'pm25', value)).toBe(index);
  });

  it('interpolates inside a category', () => {
    expect(aqi(S, 'pm25', 22.25)).toBe(75);
    expect(aqi(S, 'pm25', 37)).toBe(105);
  });
});

describe('PM10 under US EPA 2024', () => {
  it.each([
    [54, 'good', 50],
    [54.9, 'good', 50],
    [55, 'moderate', 51],
    [424, 'very_unhealthy', 300],
    [425, 'hazardous', 301],
    [604, 'hazardous', 500],
    [605, 'hazardous', 500],
  ] as [number, CategoryId, number][])('%s µg/m³ → %s, AQI %s', (value, category, index) => {
    expect(categorize(S, 'pm10', value)).toBe(category);
    expect(aqi(S, 'pm10', value)).toBe(index);
  });
});

describe('invalid input', () => {
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1])('%s → null', (value) => {
    for (const pollutant of ['pm25', 'pm10'] as const) {
      expect(categorize(S, pollutant, value)).toBeNull();
      expect(aqi(S, pollutant, value)).toBeNull();
    }
  });
});

describe('float safety', () => {
  // Upper bounds of every category except the last, in tenths of µg/m³.
  const BOUNDS: [number, CategoryId][] = [
    [90, 'good'],
    [354, 'moderate'],
    [554, 'unhealthy_sensitive'],
    [1254, 'unhealthy'],
    [2254, 'very_unhealthy'],
  ];
  const reference = (k: number): CategoryId => BOUNDS.find(([max]) => k <= max)?.[1] ?? 'hazardous';

  it('categorize matches an integer reference for every 0.1 step', () => {
    for (let k = 0; k <= 3300; k++) {
      expect(categorize(S, 'pm25', k / 10), `value ${k / 10}`).toBe(reference(k));
    }
  });

  it('treats accumulated float error as the intended decimal (0.1 added k times)', () => {
    // Summing 0.1 ten times gives 0.9999999999999999; a plain floor would
    // read it as 0.9 and could put a mean one category too low at a boundary.
    let sum = 0;
    for (let k = 1; k <= 3300; k++) {
      sum += 0.1;
      expect(categorize(S, 'pm25', sum), `0.1 × ${k} = ${sum}`).toBe(reference(k));
    }
  });

  it('aqi never decreases as the concentration grows', () => {
    let previous = -1;
    for (let k = 0; k <= 3300; k++) {
      const current = aqi(S, 'pm25', k / 10)!;
      expect(current, `value ${k / 10}`).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});
