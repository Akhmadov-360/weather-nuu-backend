import type { AggregateBucketRow, VentilationAdvice } from "@weather/contracts";
import { eventsFromRows, type Schedule } from "../events/events.service.js";
import { DEFAULT_SETTINGS, nextAdvice, type AdviceState } from "./advice.js";
import { combineLambda } from "./combine.js";
import { estimatesFromEvents } from "./from-events.js";
import { OUTDOOR_SOURCE, type OutdoorDustSource } from "./outdoor.js";
import { OPEN_WINDOW_LAMBDA_PRIOR } from "./prior.js";

const MINUTE = 60_000;
const DAY = 86_400_000;
/** The dust inside is the mean of this many last minutes of the Room kit. */
const INSIDE_MINUTES = 6;
/** A reading older than this is not "now": the kit is silent. */
const FRESH_MINUTES = 10;
/** The speed of air exchange is looked for in the readings of this many days, and re-estimated this often. */
const LAMBDA_DAYS = 14;
const LAMBDA_TTL_MS = 6 * 3_600_000;

export type VentilationDeps = {
  aggregate(params: { source: "room" | "street"; from: Date; to: Date }): Promise<AggregateBucketRow[]>;
  outdoor: OutdoorDustSource;
};

type Lambda = VentilationAdvice["lambda"];

/** Mean of the last minutes of a metric, and the time of the latest bucket; `null` when there is none or it is old. */
function recentMean(rows: AggregateBucketRow[], pick: (r: AggregateBucketRow) => number | null, now: Date): { value: number; at: Date } | null {
  const usable = rows.filter((r) => pick(r) !== null);
  if (!usable.length) return null;
  const total = usable.reduce((s, r) => s + r.count, 0);
  const value = usable.reduce((s, r) => s + pick(r)! * r.count, 0) / Math.max(1, total);
  const at = new Date(Date.parse(usable.at(-1)!.ts) + MINUTE);
  return now.getTime() - at.getTime() > FRESH_MINUTES * MINUTE ? null : { value, at };
}

/**
 * The advice on the window of the auditorium (link 2): the dust inside from the Room kit, the dust outside from the
 * model (the Street kit has no dust sensor), the speed of air exchange measured in this room when its readings
 * contain enough ventilations and taken from the literature when they do not, and the rule of advice.ts with its memory.
 */
export class VentilationService {
  private state: AdviceState | null = null;
  private lambdaCache: { at: number; value: Lambda } | null = null;
  private last: { at: number; value: VentilationAdvice } | null = null;

  constructor(
    private readonly deps: VentilationDeps,
    private readonly options: { schedule: Schedule; utcOffsetMin: number; now?: () => Date; cacheMs?: number },
  ) {}

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  /** The speed of air exchange with the window open: measured here, or the literature value marked as such. */
  async lambdaOpen(): Promise<Lambda> {
    const now = this.now().getTime();
    if (this.lambdaCache && now - this.lambdaCache.at < LAMBDA_TTL_MS) return this.lambdaCache.value;
    const prior: Lambda = { value: OPEN_WINDOW_LAMBDA_PRIOR.value, source: "prior", verified: OPEN_WINDOW_LAMBDA_PRIOR.verified, range: null };
    let value = prior;
    try {
      const to = this.now();
      const from = new Date(to.getTime() - LAMBDA_DAYS * DAY);
      const padded = new Date(from.getTime() - 90 * MINUTE);
      const [room, street] = await Promise.all([this.deps.aggregate({ source: "room", from: padded, to }), this.deps.aggregate({ source: "street", from: padded, to })]);
      const estimates: { lambda: number; se: number }[] = [];
      eventsFromRows({
        room,
        street,
        from,
        to,
        schedule: this.options.schedule,
        utcOffsetMin: this.options.utcOffsetMin,
        onSegment: (samples, events) => estimates.push(...estimatesFromEvents(samples, events)),
      });
      const combined = combineLambda(estimates, { prior: OPEN_WINDOW_LAMBDA_PRIOR.value });
      if (combined.source === "data") value = { value: combined.lambda, source: "data", verified: true, range: combined.spread };
    } catch {
      // Without the estimation the literature value is used, and the answer says so.
    }
    this.lambdaCache = { at: now, value };
    return value;
  }

  /** The advice now. Kept for a minute (the hysteresis counts time, and many visitors ask the same). */
  advice = async (): Promise<VentilationAdvice> => {
    const now = this.now();
    if (this.last && now.getTime() - this.last.at < (this.options.cacheMs ?? 60_000)) return this.last.value;

    const from = new Date(now.getTime() - INSIDE_MINUTES * MINUTE);
    const [roomRows, streetRows, outdoor, lambda] = await Promise.all([
      this.deps.aggregate({ source: "room", from, to: now }),
      this.deps.aggregate({ source: "street", from: new Date(now.getTime() - FRESH_MINUTES * MINUTE), to: now }),
      this.deps.outdoor.get(),
      this.lambdaOpen(),
    ]);
    const inside = recentMean(roomRows, (r) => r.pm25.avg, now);
    const streetTemp = recentMean(streetRows, (r) => r.temp.avg, now);

    const settings = DEFAULT_SETTINGS;
    const common = {
      computedAt: now.toISOString(),
      inside: inside ? { pm25: Math.round(inside.value * 10) / 10, at: inside.at.toISOString() } : null,
      outside: outdoor
        ? { pm25: outdoor.current.pm25, at: outdoor.current.at.toISOString(), kind: "model" as const, source: OUTDOOR_SOURCE.name, attributionUrl: OUTDOOR_SOURCE.url }
        : null,
      outsideTemp: streetTemp ? Math.round(streetTemp.value * 10) / 10 : null,
      horizonMinutes: settings.horizonMinutes,
      lambda,
      forecast: (outdoor?.forecast ?? []).slice(0, 6),
    };

    let value: VentilationAdvice;
    if (!inside) {
      // Nothing to improve or to compare: the Room kit is silent.
      this.state = null;
      value = { ...common, verdict: "unknown", reason: "no_indoor_data", predicted: null, predictedRange: null, gain: null };
    } else {
      const result = nextAdvice(
        this.state,
        {
          inside: inside.value,
          outside: outdoor ? outdoor.current.pm25 : null,
          outsideTemp: streetTemp ? streetTemp.value : null,
          lambdaOpen: lambda.value,
          lambdaOpenRange: lambda.range,
          lambdaSource: lambda.source,
          outsideForecast: outdoor?.forecast ?? [],
        },
        now.getTime(),
        settings,
      );
      this.state = result.state;
      const a = result.advice;
      const round = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
      value = {
        ...common,
        verdict: a.verdict,
        reason: a.reason,
        predicted: round(a.predicted),
        predictedRange: a.predictedRange ? [Math.round(a.predictedRange[0] * 10) / 10, Math.round(a.predictedRange[1] * 10) / 10] : null,
        gain: round(a.gain),
      };
    }
    this.last = { at: now.getTime(), value };
    return value;
  };
}
