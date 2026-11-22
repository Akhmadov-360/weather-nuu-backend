/**
 * Text to terms for the keyword search. Lower case; the apostrophes of the Uzbek Latin alphabet (ʻ ʼ ’ ‘ ` ´)
 * are one sign and are dropped inside a word (o'zbek = ozbek), so that the old and the new spelling meet;
 * names with a dot or a hyphen (PM2.5, MQ-3) stay whole and are also split into their parts. Words longer
 * than STEM_LENGTH letters are cut to that length: a crude stem that makes "пыль", "пыли", "пылью" or
 * "dust", "dusty" one term in every language of the project, without a dictionary.
 */
const APOSTROPHES = /[ʻʼ’‘`´]/g;
const TOKEN = /[\p{L}\p{N}]+(?:[.\-'][\p{L}\p{N}]+)*/gu;
export const STEM_LENGTH = 6;

export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(APOSTROPHES, "'");
}

function stem(word: string): string {
  return /^\p{L}+$/u.test(word) && word.length > STEM_LENGTH ? word.slice(0, STEM_LENGTH) : word;
}

export function tokenize(text: string): string[] {
  const terms: string[] = [];
  for (const match of normalizeText(text).matchAll(TOKEN)) {
    const token = match[0];
    if (/[.-]/.test(token)) {
      terms.push(token.replace(/'/g, ""));
      for (const part of token.split(/[.\-']/)) if (part) terms.push(stem(part));
    } else {
      terms.push(stem(token.replace(/'/g, "")));
    }
  }
  return terms;
}
