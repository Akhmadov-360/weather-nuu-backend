import { describe, expect, it } from 'vitest';
import { WHO_2021_GUIDELINES } from '../guidelines.js';
import { DEFAULT_STANDARD_ID, STANDARDS, getStandard } from '../registry.js';
import { US_EPA_2024 } from './us-epa-2024.js';

describe('US EPA 2024 breakpoints', () => {
  it('PM2.5 table matches the EPA 2024 AQS table', () => {
    expect(US_EPA_2024.decimals.pm25).toBe(1);
    expect(US_EPA_2024.breakpoints.pm25).toEqual([
      { category: 'good', cLow: 0.0, cHigh: 9.0, aqiLow: 0, aqiHigh: 50 },
      { category: 'moderate', cLow: 9.1, cHigh: 35.4, aqiLow: 51, aqiHigh: 100 },
      { category: 'unhealthy_sensitive', cLow: 35.5, cHigh: 55.4, aqiLow: 101, aqiHigh: 150 },
      { category: 'unhealthy', cLow: 55.5, cHigh: 125.4, aqiLow: 151, aqiHigh: 200 },
      { category: 'very_unhealthy', cLow: 125.5, cHigh: 225.4, aqiLow: 201, aqiHigh: 300 },
      { category: 'hazardous', cLow: 225.5, cHigh: 325.4, aqiLow: 301, aqiHigh: 500 },
    ]);
  });

  it('PM10 table matches the EPA 2024 AQS table', () => {
    expect(US_EPA_2024.decimals.pm10).toBe(0);
    expect(US_EPA_2024.breakpoints.pm10).toEqual([
      { category: 'good', cLow: 0, cHigh: 54, aqiLow: 0, aqiHigh: 50 },
      { category: 'moderate', cLow: 55, cHigh: 154, aqiLow: 51, aqiHigh: 100 },
      { category: 'unhealthy_sensitive', cLow: 155, cHigh: 254, aqiLow: 101, aqiHigh: 150 },
      { category: 'unhealthy', cLow: 255, cHigh: 354, aqiLow: 151, aqiHigh: 200 },
      { category: 'very_unhealthy', cLow: 355, cHigh: 424, aqiLow: 201, aqiHigh: 300 },
      { category: 'hazardous', cLow: 425, cHigh: 604, aqiLow: 301, aqiHigh: 500 },
    ]);
  });

  it.each(['pm25', 'pm10'] as const)('%s rows are contiguous', (pollutant) => {
    const rows = US_EPA_2024.breakpoints[pollutant];
    const step = 10 ** -US_EPA_2024.decimals[pollutant];
    for (let i = 0; i < rows.length - 1; i++) {
      expect(Math.abs(rows[i + 1]!.cLow - rows[i]!.cHigh - step)).toBeLessThan(1e-9);
      expect(rows[i + 1]!.aqiLow).toBe(rows[i]!.aqiHigh + 1);
    }
  });

  it('describes the standard for the UI and the registry', () => {
    expect(US_EPA_2024.id).toBe('us-epa-2024');
    expect(US_EPA_2024.nameKey).toBe('standard_us_epa_2024');
    expect(US_EPA_2024.averaging).toEqual({ pm25: '24h', pm10: '24h' });
  });
});

describe('WHO 2021 reference values', () => {
  it('lists the 24 h and annual guideline levels', () => {
    expect(WHO_2021_GUIDELINES).toEqual(
      expect.arrayContaining([
        { pollutant: 'pm25', period: '24h', value: 15 },
        { pollutant: 'pm25', period: 'year', value: 5 },
        { pollutant: 'pm10', period: '24h', value: 45 },
        { pollutant: 'pm10', period: 'year', value: 15 },
      ]),
    );
    expect(WHO_2021_GUIDELINES).toHaveLength(4);
  });
});

describe('standards registry', () => {
  it('getStandard falls back to the default for unknown or missing ids', () => {
    expect(getStandard('nope')).toBe(US_EPA_2024);
    expect(getStandard()).toBe(US_EPA_2024);
    expect(getStandard('us-epa-2024')).toBe(US_EPA_2024);
  });

  it('registers the default standard under its id', () => {
    expect(DEFAULT_STANDARD_ID).toBe('us-epa-2024');
    expect(STANDARDS[DEFAULT_STANDARD_ID]).toBe(US_EPA_2024);
  });
});
