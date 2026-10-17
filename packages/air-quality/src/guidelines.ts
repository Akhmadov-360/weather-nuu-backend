import type { Pollutant } from './types.js';

/**
 * WHO global air quality guideline levels, 2021 (µg/m³). Shown as a
 * reference next to the scale; they are not categories and do not take
 * part in any calculation.
 */
export const WHO_2021_GUIDELINES: { pollutant: Pollutant; period: '24h' | 'year'; value: number }[] = [
  { pollutant: 'pm25', period: '24h', value: 15 },
  { pollutant: 'pm25', period: 'year', value: 5 },
  { pollutant: 'pm10', period: '24h', value: 45 },
  { pollutant: 'pm10', period: 'year', value: 15 },
];
