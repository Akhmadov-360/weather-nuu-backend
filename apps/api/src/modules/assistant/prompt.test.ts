import { describe, expect, it } from "vitest";
import { buildSystemPrompt, exhaustedMessage, PROMPT_VERSION, UZBEK_NEW_ALPHABET_FROM } from "./prompt.js";

const NOW = new Date("2026-11-21T10:00:00Z"); // 15:00 in Tashkent

const prompt = (over: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}) =>
  buildSystemPrompt({ lang: "ru", context: "room", now: NOW, ...over });

describe("buildSystemPrompt", () => {
  it("says numbers come only from the tools of the current turn, not from the dialogue", () => {
    const text = prompt();
    expect(text).toMatch(/only from the tools/i);
    expect(text).toMatch(/earlier messages/i);
    expect(text).toMatch(/not data/i);
  });

  it("says what to do when there is no data, and that this is not medical advice", () => {
    const text = prompt();
    expect(text).toMatch(/no data/i);
    expect(text).toMatch(/medical advice/i);
  });

  it("describes the station: Room by the air conditioner, Street outside the window without a dust sensor", () => {
    const text = prompt();
    expect(text).toMatch(/air conditioner/i);
    expect(text).toMatch(/outside the window/i);
    expect(text).toMatch(/street[^.]*no dust sensor/i);
  });

  it("gives the time in Tashkent", () => {
    expect(prompt()).toContain("2026-11-21 15:00");
    expect(prompt()).toMatch(/Asia\/Tashkent/);
  });

  it("tells the model which page the question comes from", () => {
    expect(prompt({ context: "street" })).toMatch(/street page/i);
    expect(prompt({ context: "room" })).toMatch(/room page/i);
  });

  it("asks for the language of the visitor", () => {
    expect(prompt({ lang: "ru" })).toMatch(/Russian/);
    expect(prompt({ lang: "en" })).toMatch(/English/);
    expect(prompt({ lang: "uz" })).toMatch(/Uzbek/);
  });

  it("declines questions that are not about the air and the station", () => {
    expect(prompt()).toMatch(/off-topic|not about/i);
  });
});

describe("the Uzbek alphabet", () => {
  it("asks for the current Latin spelling before 22 April 2027", () => {
    const text = prompt({ lang: "uz", now: new Date("2027-04-20T00:00:00Z") });
    expect(text).toMatch(/oʻ|o'/);
    expect(text).toMatch(/sh, ch/);
    expect(text).not.toMatch(/Ş/);
  });

  it("asks for the new alphabet from 22 April 2027 (Tashkent time)", () => {
    const before = prompt({ lang: "uz", now: new Date(UZBEK_NEW_ALPHABET_FROM.getTime() - 1) });
    const after = prompt({ lang: "uz", now: UZBEK_NEW_ALPHABET_FROM });
    expect(before).not.toMatch(/Ş/);
    expect(after).toMatch(/Ş/);
    expect(after).toMatch(/Ç/);
    expect(after).toMatch(/Ö/);
    expect(after).toMatch(/Ğ/);
  });

  it("switches on 22 April 2027 at midnight in Tashkent", () => {
    expect(UZBEK_NEW_ALPHABET_FROM.toISOString()).toBe("2027-04-21T19:00:00.000Z");
  });

  it("does not mention the alphabet for other languages", () => {
    expect(prompt({ lang: "ru", now: UZBEK_NEW_ALPHABET_FROM })).not.toMatch(/Ş/);
  });
});

describe("exhaustedMessage and the version", () => {
  it("has a text in every language, all different", () => {
    const texts = (["ru", "uz", "en"] as const).map(exhaustedMessage);
    expect(texts.every((t) => t.length > 10)).toBe(true);
    expect(new Set(texts).size).toBe(3);
  });

  it("has a dated version to write into the log", () => {
    expect(PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
