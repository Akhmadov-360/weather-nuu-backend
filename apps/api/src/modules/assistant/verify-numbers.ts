/** Whole numbers up to this are list numbers, hours, days: they are not readings. */
const SMALL_WHOLE_MAX = 31;

const NUMBER = /\d+(?:[.,]\d+)?/g;

type Found = { value: number; decimals: number; text: string };

function normalize(token: string): { value: number; decimals: number } {
  const dotted = token.replace(",", ".");
  const decimals = dotted.includes(".") ? dotted.length - dotted.indexOf(".") - 1 : 0;
  return { value: Number(dotted), decimals };
}

/** Numbers in a text, without the digits that are part of a name (PM2.5, MQ-5) and without dates and times. */
function numbersIn(text: string): Found[] {
  const cleaned = text.replace(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g, " ").replace(/\d{1,2}:\d{2}(?::\d{2})?/g, " ");
  const found: Found[] = [];
  for (const match of cleaned.matchAll(NUMBER)) {
    const at = match.index ?? 0;
    const before = cleaned[at - 1] ?? "";
    const beforeThat = cleaned[at - 2] ?? "";
    if (/[\p{L}]/u.test(before) || (before === "-" && /[\p{L}]/u.test(beforeThat))) continue;
    found.push({ ...normalize(match[0]), text: match[0].replace(",", ".") });
  }
  return found;
}

/**
 * The numbers of an answer that no tool returned. The model is told to take every figure from the tools and
 * not to calculate; this checks it. A figure counts as verified when some tool number matches it to the
 * precision the answer shows (so 24,66 given as 24,7 or 25 is fine). Small whole numbers, times, dates and
 * numbers the visitor wrote in the question are let through. It is only a signal for the log and the evaluation:
 * it never changes what the visitor sees.
 */
export function findUnverifiedNumbers(answer: string, toolResults: string[], question: string): string[] {
  const known = toolResults.flatMap((r) => numbersIn(r).map((n) => n.value));
  const asked = numbersIn(question).map((n) => n.value);
  const unverified: string[] = [];
  for (const n of numbersIn(answer)) {
    if (n.decimals === 0 && n.value <= SMALL_WHOLE_MAX) continue;
    const tolerance = 0.5 * 10 ** -n.decimals + 1e-9;
    const fits = (v: number) => Math.abs(v - n.value) <= tolerance;
    if (known.some(fits) || asked.some(fits)) continue;
    if (!unverified.includes(n.text)) unverified.push(n.text);
  }
  return unverified;
}
