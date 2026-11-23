import type { Schedule } from "./events.service.js";

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "13:30, 15:10" to minutes of the day (local time). Anything that is not a time is an error: a wrong schedule must not be ignored quietly. */
export function parseTimes(text: string | undefined): number[] {
  if (!text?.trim()) return [];
  return text.split(",").map((part) => {
    const m = TIME.exec(part.trim());
    if (!m) throw new Error(`"${part.trim()}" is not a time like 13:30`);
    return Number(m[1]) * 60 + Number(m[2]);
  });
}

export function parseSchedule(starts: string | undefined, ends: string | undefined): Schedule {
  return { lessonStarts: parseTimes(starts), lessonEnds: parseTimes(ends) };
}
