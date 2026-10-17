import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS, US_EPA_2024 } from './index.js';

describe('CATEGORY_IDS', () => {
  it('lists the six categories from best to worst', () => {
    expect(CATEGORY_IDS).toEqual(['good', 'moderate', 'unhealthy_sensitive', 'unhealthy', 'very_unhealthy', 'hazardous']);
  });

  it('matches the rows of every pollutant table in the same order', () => {
    for (const rows of Object.values(US_EPA_2024.breakpoints)) {
      expect(rows.map((row) => row.category)).toEqual([...CATEGORY_IDS]);
    }
  });
});
