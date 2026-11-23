/**
 * Synthetic series of the room with events inserted at KNOWN times. Detection of events (CUSUM and the rule
 * table) is judged against this truth: with a real room nobody wrote the events down, so this is the strict
 * check (see docs/features/SMART_ASSISTANT.md, "Проверка без ручного журнала").
 *
 * The dust follows the mass-balance model of link 2, dC/dt = a·P·C_out − (a+k)·C + S/V, stepped once a minute.
 * Temperature and humidity relax towards the street and the heating; an open window speeds that up; people
 * add a slow warm-up and moisture; the air conditioner pulls the temperature down and dries the air without
 * touching the dust. Synthetic data only: it is never a finding about the real room.
 */

export type EventClass = "ventilation" | "class_start" | "class_end" | "cleaning" | "ac";

export type Sample = {
  /** Minutes from the start of the series. */
  t: number;
  temp: number;
  hum: number;
  pm25: number;
  outTemp: number;
  outHum: number;
};

export type TruthEvent = { cls: EventClass; startMin: number; endMin: number };

export type SeriesOptions = {
  seed: number;
  days: number;
  /** Multiplies the noise of the sensors (1 = the default level). */
  noise?: number;
};

const DAY = 1440;

/** The air exchange of the synthetic room (1/h) and the deposition: the truth against which the estimation of λ is judged. */
export const SYNTHETIC_ROOM = { aClosed: 0.6, aOpenExtra: 8, k: 0.5 } as const;
/** λ = a + k with the window closed and wide open. */
export const SYNTHETIC_LAMBDA = { closed: SYNTHETIC_ROOM.aClosed + SYNTHETIC_ROOM.k, open: SYNTHETIC_ROOM.aClosed + SYNTHETIC_ROOM.aOpenExtra + SYNTHETIC_ROOM.k } as const;

export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Lessons in the auditorium: people come at 13:30 and leave at 17:50 (the schedule of the pairs). */
const PEOPLE_FROM = 13 * 60 + 30;
const PEOPLE_TO = 17 * 60 + 50;
/** Two events of different kinds are kept this far apart so that each one can be told from the others. */
const GAP = 35;

type Planned = { cls: EventClass; startMin: number; endMin: number };

function plan(rand: () => number, day: number): Planned[] {
  const base = day * DAY;
  const events: Planned[] = [
    { cls: "class_start", startMin: base + PEOPLE_FROM, endMin: base + PEOPLE_FROM + 20 },
    { cls: "class_end", startMin: base + PEOPLE_TO, endMin: base + PEOPLE_TO + 20 },
  ];
  const free = (start: number, end: number) => events.every((e) => end + GAP <= e.startMin || start >= e.endMin + GAP);
  const place = (cls: EventClass, from: number, to: number, minLen: number, maxLen: number): void => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const start = base + Math.round(from + rand() * (to - from));
      const end = start + Math.round(minLen + rand() * (maxLen - minLen));
      if (free(start, end)) {
        events.push({ cls, startMin: start, endMin: end });
        return;
      }
    }
  };
  if (rand() < 0.75) place("ac", PEOPLE_FROM + 25, 16 * 60, 50, 90);
  const windows = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < windows; i++) place("ventilation", PEOPLE_FROM + 20, PEOPLE_TO - 20, 8, 14);
  if (rand() < 0.7) place("cleaning", PEOPLE_TO + 45, PEOPLE_TO + 110, 6, 6);
  return events;
}

/** One minute at a time; the events are known, the sensors are noisy. */
export function generateSeries(options: SeriesOptions): { samples: Sample[]; truth: TruthEvent[] } {
  const rand = mulberry32(options.seed);
  const noise = options.noise ?? 1;
  const minutes = options.days * DAY;

  const truth: TruthEvent[] = [];
  for (let d = 0; d < options.days; d++) truth.push(...plan(rand, d));
  truth.sort((a, b) => a.startMin - b.startMin);

  const open = new Float32Array(minutes);
  const ac = new Float32Array(minutes);
  const clean = new Float32Array(minutes);
  const people = new Float32Array(minutes);
  for (const e of truth) {
    const target = e.cls === "ventilation" ? open : e.cls === "ac" ? ac : e.cls === "cleaning" ? clean : null;
    if (target) for (let m = e.startMin; m < Math.min(e.endMin, minutes); m++) target[m] = 1;
  }
  for (let d = 0; d < options.days; d++) for (let m = d * DAY + PEOPLE_FROM; m < d * DAY + PEOPLE_TO && m < minutes; m++) people[m] = 1;

  // Parameters of the room (per hour unless said otherwise).
  const { aClosed, aOpenExtra } = SYNTHETIC_ROOM;
  const pClosed = 0.85;
  const { k } = SYNTHETIC_ROOM;
  const sourceBase = 22;
  const sourcePeople = 6;
  const sourceClean = 150;
  const envRate = 0.3;
  const envOpenExtra = 2;
  const heating = envRate * (22 - 8);
  const humBase = envRate * (42 - 65);
  const dt = 1 / 60;

  const dayOffset = Array.from({ length: options.days }, () => rand() * 6);
  const samples: Sample[] = [];

  let temp = 22;
  let hum = 42;
  let pm = (aClosed * pClosed * 14 + sourceBase) / (aClosed + k);
  let tPeople = 0;
  let hPeople = 0;
  let acTarget = 0;
  let acWasOn = 0;
  let aOpen = 0;

  for (let t = 0; t < minutes; t++) {
    const phase = 2 * Math.PI * ((t % DAY) / DAY - 0.375);
    const outTemp = 8 + 5 * Math.sin(phase);
    const outHum = 65 - 12 * Math.sin(phase);
    const outPm = 14 + dayOffset[Math.floor(t / DAY)]! + 4 * Math.sin((2 * Math.PI * t) / (DAY * 1.3));

    // The window opens and closes over about three minutes.
    aOpen += (open[t]! - aOpen) * 0.3;
    const a = aClosed + aOpenExtra * aOpen;
    const p = pClosed + (1 - pClosed) * aOpen;

    // Dust: the mass balance.
    pm += (a * p * outPm - (a + k) * pm + sourceBase + sourcePeople * (people[t]! > 0 ? 1 : 0) + sourceClean * clean[t]!) * dt;

    // People warm and moisten the air slowly (a time constant of 40 minutes).
    tPeople += (0.9 * people[t]! - tPeople) / 40;
    hPeople += (6 * people[t]! - hPeople) / 40;

    // Temperature and humidity of the room itself.
    let dTemp = (envRate + envOpenExtra * aOpen) * (outTemp - temp) + heating;
    let dHum = (envRate + envOpenExtra * aOpen) * (outHum - hum) + humBase;
    if (ac[t]! > 0) {
      if (!acWasOn) acTarget = temp - 4;
      const pull = 5 * (acTarget - temp);
      dTemp += pull;
      // Cooling dries the air: humidity moves with the temperature the conditioner took away.
      dHum += 1.8 * pull;
    }
    acWasOn = ac[t]!;
    temp += dTemp * dt;
    hum += dHum * dt;

    samples.push({
      t,
      temp: temp + tPeople + gauss(rand) * 0.06 * noise,
      hum: hum + hPeople + gauss(rand) * 0.35 * noise,
      pm25: Math.max(0.5, pm + gauss(rand) * 1.0 * noise),
      outTemp,
      outHum,
    });
  }

  return { samples, truth };
}
