import type { Standard } from '../types.js';

/**
 * US EPA Air Quality Index, 2024 revision (24 h averages, µg/m³).
 * Source: the EPA AQS breakpoint table (aqi_breakpoints.csv). Rows above
 * AQI 500 are deliberately not modelled; calc caps the result at 500.
 */
export const US_EPA_2024: Standard = {
  id: 'us-epa-2024',
  nameKey: 'standard_us_epa_2024',
  averaging: { pm25: '24h', pm10: '24h' },
  decimals: { pm25: 1, pm10: 0 },
  breakpoints: {
    pm25: [
      { category: 'good', cLow: 0.0, cHigh: 9.0, aqiLow: 0, aqiHigh: 50 },
      { category: 'moderate', cLow: 9.1, cHigh: 35.4, aqiLow: 51, aqiHigh: 100 },
      { category: 'unhealthy_sensitive', cLow: 35.5, cHigh: 55.4, aqiLow: 101, aqiHigh: 150 },
      { category: 'unhealthy', cLow: 55.5, cHigh: 125.4, aqiLow: 151, aqiHigh: 200 },
      { category: 'very_unhealthy', cLow: 125.5, cHigh: 225.4, aqiLow: 201, aqiHigh: 300 },
      { category: 'hazardous', cLow: 225.5, cHigh: 325.4, aqiLow: 301, aqiHigh: 500 },
    ],
    pm10: [
      { category: 'good', cLow: 0, cHigh: 54, aqiLow: 0, aqiHigh: 50 },
      { category: 'moderate', cLow: 55, cHigh: 154, aqiLow: 51, aqiHigh: 100 },
      { category: 'unhealthy_sensitive', cLow: 155, cHigh: 254, aqiLow: 101, aqiHigh: 150 },
      { category: 'unhealthy', cLow: 255, cHigh: 354, aqiLow: 151, aqiHigh: 200 },
      { category: 'very_unhealthy', cLow: 355, cHigh: 424, aqiLow: 201, aqiHigh: 300 },
      { category: 'hazardous', cLow: 425, cHigh: 604, aqiLow: 301, aqiHigh: 500 },
    ],
  },
};
