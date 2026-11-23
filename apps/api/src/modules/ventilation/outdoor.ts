/**
 * Dust outside as a MODEL estimate. The Street kit has no dust sensor, so the platform takes the forecast model of the
 * Copernicus Atmosphere Monitoring Service (CAMS) through the free API of Open-Meteo, for the point of the station.
 * It is a model with a grid of about 11 km, not a measurement at the wall of the building: everything that shows it
 * says "model" and names the source. When the stations of the city (task B6) arrive, they replace it.
 *
 * Terms of the data (read 23.11.2026): CC BY 4.0, a link to Open-Meteo next to the data, and an attribution to the
 * CAMS ENSEMBLE data provider; the free API is for non-commercial use only (under 10 000 calls a day), no key.
 */
export const OUTDOOR_SOURCE = { name: "CAMS ENSEMBLE via Open-Meteo", url: "https://open-meteo.com/" } as const;

export type OutdoorDust = {
  /** PM2.5 now, µg/m³, and the hour it belongs to. */
  current: { pm25: number; at: Date };
  /** The next hours, hours ahead and µg/m³. */
  forecast: { hours: number; value: number }[];
  fetchedAt: Date;
};

export interface OutdoorDustSource {
  get(): Promise<OutdoorDust | null>;
}

type OpenMeteoAnswer = {
  current?: { time?: string; pm2_5?: number | null };
  hourly?: { time?: string[]; pm2_5?: (number | null)[] };
};

const HOUR = 3_600_000;

/** Opens the answer of Open-Meteo (times in UTC without a zone mark) into what the advice needs. Exported for tests. */
export function parseOpenMeteo(answer: OpenMeteoAnswer, now: Date): OutdoorDust | null {
  const utc = (t: string) => new Date(`${t}:00Z`);
  const currentTime = answer.current?.time;
  const value = answer.current?.pm2_5;
  if (!currentTime || typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const forecast: { hours: number; value: number }[] = [];
  const times = answer.hourly?.time ?? [];
  const values = answer.hourly?.pm2_5 ?? [];
  times.forEach((t, i) => {
    const v = values[i];
    const hours = (utc(t).getTime() - now.getTime()) / HOUR;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && hours > 0 && hours <= 12) forecast.push({ hours: Math.round(hours * 10) / 10, value: v });
  });
  return { current: { pm25: value, at: utc(currentTime) }, forecast, fetchedAt: now };
}

export class OpenMeteoOutdoor implements OutdoorDustSource {
  private cached: OutdoorDust | null = null;
  private inFlight: Promise<OutdoorDust | null> | null = null;

  constructor(
    private readonly options: {
      lat: number;
      lon: number;
      /** How long an answer is reused, ms: the model changes by the hour, and the free API has a daily limit. */
      ttlMs?: number;
      /** An answer older than this is not used even when a new one cannot be had, ms. */
      maxStaleMs?: number;
      baseUrl?: string;
      fetch?: typeof fetch;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  async get(): Promise<OutdoorDust | null> {
    const now = this.now();
    const ttl = this.options.ttlMs ?? 30 * 60_000;
    if (this.cached && now.getTime() - this.cached.fetchedAt.getTime() < ttl) return this.cached;
    // Many visitors at once ask the service once.
    this.inFlight ??= this.fetchFresh().finally(() => {
      this.inFlight = null;
    });
    const fresh = await this.inFlight;
    if (fresh) return fresh;
    // The service did not answer: the last answer is better than none, for a while.
    const stale = this.cached;
    return stale && now.getTime() - stale.fetchedAt.getTime() < (this.options.maxStaleMs ?? 3 * HOUR) ? stale : null;
  }

  private async fetchFresh(): Promise<OutdoorDust | null> {
    const base = this.options.baseUrl ?? "https://air-quality-api.open-meteo.com";
    const query = new URLSearchParams({
      latitude: String(this.options.lat),
      longitude: String(this.options.lon),
      current: "pm2_5",
      hourly: "pm2_5",
      forecast_hours: "13",
      timezone: "UTC",
    });
    try {
      const response = await (this.options.fetch ?? fetch)(`${base}/v1/air-quality?${query}`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return null;
      const parsed = parseOpenMeteo((await response.json()) as OpenMeteoAnswer, this.now());
      if (parsed) this.cached = parsed;
      return parsed;
    } catch {
      return null;
    }
  }
}
