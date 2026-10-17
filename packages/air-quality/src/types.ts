export type Pollutant = 'pm25' | 'pm10';

/** The six categories from best to worst; the order of the table rows and of severity. */
export const CATEGORY_IDS = [
  'good',
  'moderate',
  'unhealthy_sensitive',
  'unhealthy',
  'very_unhealthy',
  'hazardous',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

/** One row of a standard's table: a concentration range and the AQI range it maps onto. */
export type Breakpoint = {
  category: CategoryId;
  cLow: number;
  cHigh: number;
  aqiLow: number;
  aqiHigh: number;
};

/**
 * An air-quality standard described as data. Adding a regional norm means
 * adding one more object of this shape to the registry, not changing code.
 */
export type Standard = {
  id: string;
  /** i18n key of the human-readable name; resolved by the UI, not here. */
  nameKey: string;
  averaging: Record<Pollutant, '24h'>;
  /** Digits kept when a concentration is truncated before lookup. */
  decimals: Record<Pollutant, number>;
  breakpoints: Record<Pollutant, Breakpoint[]>;
};
