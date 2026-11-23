import type { AggregateBucketRow, EventsResponse, RoomEvent, RoomEventClass } from "@weather/contracts";
import { detectEvents, type DetectedEvent } from "./detect.js";
import type { Sample } from "./synthetic.js";

const MINUTE = 60_000;
const DAY = 1440 * MINUTE;
/** The detector looks back this far to know what the room was doing before; it is read before `from` and thrown away. */
const PAD_MINUTES = 90;
/** A gap in the readings longer than this splits the series: the detector never bridges a hole in the data. */
const MAX_GAP_MINUTES = 5;
/** A series shorter than this has no baseline to compare with. */
const MIN_SEGMENT = 150;
/** Ventilation is confirmed by the street only when the room and the street differ by at least this many degrees... */
const WITNESS_MIN_DIFFERENCE = 3;
/** ...and the difference shrinks by at least this much while the window is open. */
const WITNESS_MIN_CLOSING = 1.5;

export type Schedule = { lessonStarts: number[]; lessonEnds: number[] };

type Point = { minute: number; temp: number; hum: number; pm25: number };

function pointsFrom(rows: AggregateBucketRow[]): Point[] {
  return rows
    .flatMap((r) => {
      const { temp, hum, pm25 } = { temp: r.temp.avg, hum: r.hum.avg, pm25: r.pm25.avg };
      return temp === null || hum === null || pm25 === null ? [] : [{ minute: Math.round(Date.parse(r.ts) / MINUTE), temp, hum, pm25 }];
    })
    .sort((a, b) => a.minute - b.minute);
}

/** Runs of minutes without a hole longer than the allowed gap, the small holes filled by a straight line. */
function segments(points: Point[]): Point[][] {
  const out: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    const last = run.at(-1);
    if (last && p.minute - last.minute > MAX_GAP_MINUTES) {
      out.push(run);
      run = [];
    }
    if (last && p.minute - last.minute > 1 && run.length) {
      for (let m = last.minute + 1; m < p.minute; m++) {
        const k = (m - last.minute) / (p.minute - last.minute);
        run.push({ minute: m, temp: last.temp + k * (p.temp - last.temp), hum: last.hum + k * (p.hum - last.hum), pm25: last.pm25 + k * (p.pm25 - last.pm25) });
      }
    }
    run.push(p);
  }
  if (run.length) out.push(run);
  return out.filter((s) => s.length >= MIN_SEGMENT);
}

/** The day starts at local midnight: the schedule of the lessons is given in local time. */
function localMidnight(ms: number, utcOffsetMin: number): number {
  return Math.floor((ms + utcOffsetMin * MINUTE) / DAY) * DAY - utcOffsetMin * MINUTE;
}

function mean(values: (number | undefined)[]): number | null {
  const v = values.filter((x): x is number => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/**
 * The events of the room in a period, from the 1-minute averages of the room and of the street. Pure: the
 * numbers in, the events out. The detector is the CUSUM with the table of rules (detect.ts); here it only gets
 * a clean series (holes not bridged, the time counted from local midnight) and its answer is turned back into
 * dates. A ventilation is checked against the street: the independent witness of docs/features/SMART_ASSISTANT.md.
 */
export function eventsFromRows(input: {
  room: AggregateBucketRow[];
  street: AggregateBucketRow[];
  from: Date;
  to: Date;
  schedule: Schedule;
  utcOffsetMin: number;
  /** Called with every stretch of the series and the events the detector found in it (the estimation of the speed of air exchange needs them). */
  onSegment?: (samples: Sample[], events: DetectedEvent[]) => void;
}): EventsResponse {
  const { from, to, schedule } = input;
  const dayZero = localMidnight(from.getTime(), input.utcOffsetMin);
  const streetTemp = new Map(input.street.flatMap((r): [number, number][] => (r.temp.avg === null ? [] : [[Math.round(Date.parse(r.ts) / MINUTE), r.temp.avg]])));
  const roomTemp = new Map<number, number>();

  const room = pointsFrom(input.room);
  room.forEach((p) => roomTemp.set(p.minute, p.temp));

  const events: RoomEvent[] = [];
  for (const seg of segments(room)) {
    const samples: Sample[] = seg.map((p) => ({ t: (p.minute * MINUTE - dayZero) / MINUTE, temp: p.temp, hum: p.hum, pm25: p.pm25, outTemp: streetTemp.get(p.minute) ?? p.temp, outHum: p.hum }));
    const detected = detectEvents(samples, schedule);
    input.onSegment?.(samples, detected);
    for (const e of detected) {
      const start = new Date(dayZero + e.startMin * MINUTE);
      if (start < from || start > to) continue;
      const startMinute = Math.round(start.getTime() / MINUTE);
      let confirmedByStreet: boolean | null = null;
      if (e.cls === "ventilation") {
        const gap = (minute: number) => {
          const inside = mean([-1, 0, 1].map((d) => roomTemp.get(minute + d)));
          const outside = mean([-1, 0, 1].map((d) => streetTemp.get(minute + d)));
          return inside === null || outside === null ? null : Math.abs(inside - outside);
        };
        const before = gap(startMinute - 2);
        const after = gap(startMinute + 12);
        if (before !== null && after !== null && before >= WITNESS_MIN_DIFFERENCE) confirmedByStreet = before - after >= WITNESS_MIN_CLOSING;
      }
      events.push({
        cls: e.cls,
        start: start.toISOString(),
        detected: new Date(Math.max(dayZero + e.detectedMin * MINUTE, start.getTime())).toISOString(),
        confirmedByStreet,
      });
    }
  }
  events.sort((a, b) => a.start.localeCompare(b.start));

  const classes: RoomEventClass[] = ["ventilation", "cleaning", "ac"];
  if (schedule.lessonStarts.length) classes.push("class_start");
  if (schedule.lessonEnds.length) classes.push("class_end");
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    events,
    method: { name: "cusum-rules-v1", experimental: true, classes },
    coverageMinutes: room.filter((p) => p.minute * MINUTE >= from.getTime() && p.minute * MINUTE <= to.getTime()).length,
  };
}

export type EventsDeps = {
  /** 1-minute averages of a sensor, from `from` to `to`. */
  aggregate(params: { source: "room" | "street"; from: Date; to: Date }): Promise<AggregateBucketRow[]>;
};

/** Events of the room for a period, remembered for a minute: the same page opened by many visitors costs one calculation. */
export class EventsService {
  private readonly cache = new Map<string, { at: number; value: EventsResponse }>();

  constructor(
    private readonly deps: EventsDeps,
    private readonly options: { schedule: Schedule; utcOffsetMin: number; cacheMs?: number; now?: () => number },
  ) {}

  list = async (from: Date, to: Date): Promise<EventsResponse> => {
    const now = (this.options.now ?? Date.now)();
    const key = `${Math.floor(from.getTime() / MINUTE)}-${Math.floor(to.getTime() / MINUTE)}`;
    const hit = this.cache.get(key);
    if (hit && now - hit.at < (this.options.cacheMs ?? 60_000)) return hit.value;

    const padded = new Date(from.getTime() - PAD_MINUTES * MINUTE);
    const [room, street] = await Promise.all([this.deps.aggregate({ source: "room", from: padded, to }), this.deps.aggregate({ source: "street", from: padded, to })]);
    const value = eventsFromRows({ room, street, from, to, schedule: this.options.schedule, utcOffsetMin: this.options.utcOffsetMin });
    this.cache.set(key, { at: now, value });
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  };
}
