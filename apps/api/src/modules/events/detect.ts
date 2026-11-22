import { cusum, estimateSigma } from "./cusum.js";
import type { EventClass, Sample } from "./synthetic.js";

export type DetectedEvent = {
  cls: EventClass;
  /** Minute the change began (the start of the cluster of changes). */
  startMin: number;
  /** Minute the system could first say so. */
  detectedMin: number;
};

export type DetectOptions = {
  /** Lessons, as minutes of the day: people come at `lessonStarts` and leave at `lessonEnds`. */
  lessonStarts?: number[];
  lessonEnds?: number[];
  /** Changes of different channels this close together are one event. */
  clusterMinutes?: number;
  /** The smallest change that counts, per channel: below it a change point is the drift of the day, not an event. */
  minEffect?: Partial<Record<Channel, number>>;
};

export type Channel = "temp" | "hum" | "pm25";
type Change = { channel: Channel; start: number; detected: number; direction: 1 | -1; magnitude: number };

const DAY = 1440;
/** A lesson boundary explains a change that begins from a little before it to this long after (the room reacts slowly). */
const BOUNDARY_BEFORE = 10;
const BOUNDARY_AFTER = 40;
/** The same channel moving the same way again within this long is the same event (a slow ramp trips CUSUM several times). */
const MERGE_MINUTES = 25;
/** An open window moves the temperature by degrees; a few tenths of a degree is evening cooling, not a window. */
const VENTILATION_TEMP = 0.8;
const AC_TEMP = 0.8;
/** Cleaning raises the dust and leaves the temperature and the humidity alone (a small drift beside it is allowed). */
const SMALL_TEMP = 0.5;
const SMALL_HUM = 2.5;
/** After a window the dust climbs back by itself; for this long a rise of the dust is that, not cleaning. */
const RECOVERY_MINUTES = 75;
const MIN_EFFECT: Record<Channel, number> = { temp: 0.25, hum: 1.2, pm25: 4 };

function nearBoundary(minute: number, boundaries: number[] | undefined): boolean {
  if (!boundaries?.length) return false;
  const day = Math.floor(minute / DAY);
  return boundaries.some((b) => {
    const at = day * DAY + b;
    return minute >= at - BOUNDARY_BEFORE && minute <= at + BOUNDARY_AFTER;
  });
}

/**
 * Events in a series of the room, with no log and no labels: a change point in the temperature, the humidity
 * or the dust (CUSUM), changes of different channels gathered into one event, and a table of rules that
 * names the event by which channels moved and which way (docs/features/SMART_ASSISTANT.md, section E).
 *
 *   dust down, temperature down                        -> ventilation (clean air in, the temperature of the street)
 *   dust up, temperature and humidity unchanged        -> cleaning
 *   temperature and humidity down, no dust change      -> air conditioner
 *   temperature up/down at a lesson boundary           -> class_start / class_end (people)
 *
 * The opposite change that follows when an event ends (the window closes, the conditioner stops) does not
 * match any row and is dropped. Heating is not detected: it moves too slowly for a change point.
 */
export function detectEvents(samples: Sample[], options: DetectOptions = {}): DetectedEvent[] {
  const cluster = options.clusterMinutes ?? 12;
  const channels: Record<Channel, number[]> = {
    temp: samples.map((s) => s.temp),
    hum: samples.map((s) => s.hum),
    pm25: samples.map((s) => s.pm25),
  };

  const changes: Change[] = [];
  for (const channel of Object.keys(channels) as Channel[]) {
    const values = channels[channel];
    const minEffect = options.minEffect?.[channel] ?? MIN_EFFECT[channel];
    let last: Change | undefined;
    for (const c of cusum(values, { sigma: estimateSigma(values) })) {
      if (Math.sign(c.magnitude) !== c.direction || Math.abs(c.magnitude) < minEffect) continue;
      if (last && last.direction === c.direction && samples[c.start]!.t - last.detected <= MERGE_MINUTES) {
        if (Math.abs(c.magnitude) > Math.abs(last.magnitude)) last.magnitude = c.magnitude;
        continue;
      }
      last = { channel, start: samples[c.start]!.t, detected: samples[c.detected]!.t, direction: c.direction, magnitude: c.magnitude };
      changes.push(last);
    }
  }
  changes.sort((a, b) => a.start - b.start);

  const events: DetectedEvent[] = [];
  let lastVentilation = -Infinity;
  let group: Change[] = [];
  const flush = (): void => {
    if (!group.length) return;
    const startMin = group[0]!.start;
    const find = (channel: Channel): Change | undefined => group.find((c) => c.channel === channel);
    const temp = find("temp")?.direction ?? 0;
    const hum = find("hum")?.direction ?? 0;
    const pm = find("pm25")?.direction ?? 0;
    const tempSize = Math.abs(find("temp")?.magnitude ?? 0);
    const humSize = Math.abs(find("hum")?.magnitude ?? 0);
    let cls: EventClass | null = null;
    if (temp === 1 && pm !== -1 && nearBoundary(startMin, options.lessonStarts)) cls = "class_start";
    else if (temp === -1 && nearBoundary(startMin, options.lessonEnds)) cls = "class_end";
    else if (pm === -1 && temp === -1 && tempSize >= VENTILATION_TEMP) cls = "ventilation";
    else if (pm === 1 && tempSize < SMALL_TEMP && humSize < SMALL_HUM && startMin - lastVentilation > RECOVERY_MINUTES) cls = "cleaning";
    else if (temp === -1 && hum === -1 && pm === 0 && tempSize >= AC_TEMP) cls = "ac";
    if (cls === "ventilation") lastVentilation = startMin;
    if (cls) events.push({ cls, startMin, detectedMin: Math.min(...group.map((c) => c.detected)) });
    group = [];
  };
  for (const c of changes) {
    if (group.length && c.start - group[0]!.start > cluster) flush();
    group.push(c);
  }
  flush();
  return events;
}
