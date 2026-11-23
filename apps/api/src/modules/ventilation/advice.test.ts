import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, nextAdvice, rawAdvice, type AdviceInput } from "./advice.js";
import { evaluatePolicies, evaluateSensitivity, simulateDay, SCENARIOS } from "./advice-eval.js";

const input = (over: Partial<AdviceInput> = {}): AdviceInput => ({ inside: 40, outside: 10, outsideTemp: 15, lambdaOpen: 9, lambdaSource: "data", ...over });
const MIN = 60_000;

describe("rawAdvice: the rule", () => {
  it("says open when the street is clean and the room is not, with the dust expected in 15 minutes", () => {
    const a = rawAdvice(input(), null);
    expect(a.verdict).toBe("open");
    expect(a.reason).toBe("outside_cleaner");
    expect(a.predicted).toBeCloseTo(10 + 30 * Math.exp(-9 * 0.25), 3);
    expect(a.gain).toBeCloseTo(40 - a.predicted!, 6);
    expect(a.lambdaSource).toBe("data");
  });

  it("gives a range of the prediction from the interval of lambda: a slower lambda promises less", () => {
    const a = rawAdvice(input({ lambdaOpenRange: [4, 14] }), null);
    expect(a.predictedRange![0]).toBeLessThan(a.predicted!);
    expect(a.predictedRange![1]).toBeGreaterThan(a.predicted!);
  });

  it("says not to open when the street is worse than the room, or as bad", () => {
    expect(rawAdvice(input({ inside: 30, outside: 60 }), null)).toMatchObject({ verdict: "dont_open", reason: "outside_worse" });
    expect(rawAdvice(input({ inside: 30, outside: 30 }), null).verdict).toBe("dont_open");
  });

  it("says not to open when the street is dirtier than moderate, even if the room is dirtier still", () => {
    expect(rawAdvice(input({ inside: 150, outside: 60 }), null)).toMatchObject({ verdict: "dont_open", reason: "outside_dirty" });
    expect(rawAdvice(input({ inside: 150, outside: 35 }), null).verdict).toBe("open");
  });

  it("says nothing needs doing when the air inside is already good", () => {
    expect(rawAdvice(input({ inside: 8, outside: 3 }), null)).toMatchObject({ verdict: "not_needed", reason: "already_good" });
  });

  it("opens for a fall across the border of a category even when the share is small", () => {
    // 40 is unhealthy for sensitive groups, and the street is moderate: opening takes the room to moderate.
    expect(rawAdvice(input({ inside: 40, outside: 33 }), null).verdict).toBe("open");
  });

  it("does not open for a gain that is small in share or in units", () => {
    expect(rawAdvice(input({ inside: 30, outside: 26 }), null)).toMatchObject({ verdict: "dont_open", reason: "no_gain" });
    expect(rawAdvice(input({ inside: 12, outside: 10 }), null).verdict).toBe("dont_open");
  });

  it("does not advise a window in the cold or the heat, but keeps the numbers when the weather is fine or unknown", () => {
    expect(rawAdvice(input({ outsideTemp: -12 }), null)).toMatchObject({ verdict: "dont_open", reason: "comfort" });
    expect(rawAdvice(input({ outsideTemp: 41 }), null).reason).toBe("comfort");
    expect(rawAdvice(input({ outsideTemp: null }), null).verdict).toBe("open");
    expect(rawAdvice({ ...input(), outsideTemp: undefined }, null).verdict).toBe("open");
  });

  it("says it does not know when there is no dust outside", () => {
    expect(rawAdvice(input({ outside: null }), null)).toMatchObject({ verdict: "unknown", reason: "no_outdoor_data", predicted: null });
  });

  it("says wait, and for how long, when the street is bad now but the forecast promises a clean one soon", () => {
    // 40 outside is dirty (above moderate); the forecast gives 30 in two hours, 25 in three.
    const a = rawAdvice(input({ inside: 49, outside: 40, outsideForecast: [{ hours: 3, value: 25 }, { hours: 1, value: 38 }, { hours: 2, value: 30 }] }), null);
    expect(a).toMatchObject({ verdict: "wait", reason: "forecast_better", waitHours: 2 });
  });

  it("says wait also when the street is as dirty as the room, if the forecast promises a clean one", () => {
    const a = rawAdvice(input({ inside: 30, outside: 31, outsideForecast: [{ hours: 2, value: 12 }] }), null);
    expect(a).toMatchObject({ verdict: "wait", waitHours: 2 });
  });

  it("does not say wait when the promised street is still dirty, too far away, or not cleaner than the room by a real gain", () => {
    expect(rawAdvice(input({ inside: 80, outside: 60, outsideForecast: [{ hours: 2, value: 45 }] }), null).verdict).toBe("dont_open");
    expect(rawAdvice(input({ inside: 49, outside: 40, outsideForecast: [{ hours: 9, value: 10 }] }), null)).toMatchObject({ verdict: "dont_open", reason: "outside_dirty", waitHours: null });
    expect(rawAdvice(input({ inside: 40, outside: 45, outsideForecast: [{ hours: 2, value: 33 }] }), null).verdict).toBe("dont_open");
    expect(rawAdvice(input({ inside: 49, outside: 40, outsideForecast: [{ hours: -1, value: 5 }, { hours: 0, value: 5 }] }), null).verdict).toBe("dont_open");
  });

  it("leaves a bad weather as a plain no: waiting does not make the window comfortable", () => {
    expect(rawAdvice(input({ inside: 49, outside: 10, outsideTemp: -20, outsideForecast: [{ hours: 2, value: 5 }] }), null)).toMatchObject({ verdict: "dont_open", reason: "comfort" });
  });

  it("says wait when opening is no good now but the forecast promises a clean street soon", () => {
    const a = rawAdvice(input({ inside: 30, outside: 26, outsideForecast: [{ hours: 2, value: 12 }] }), null);
    expect(a).toMatchObject({ verdict: "wait", reason: "forecast_better" });
    expect(rawAdvice(input({ inside: 30, outside: 26, outsideForecast: [{ hours: 2, value: 25 }] }), null).verdict).toBe("dont_open");
  });
});

describe("rawAdvice: the hysteresis", () => {
  it("keeps an open window open while the gain is small, where a closed one would not be opened", () => {
    const small = input({ inside: 12, outside: 10 });
    expect(rawAdvice(small, null).verdict).toBe("dont_open");
    expect(rawAdvice(small, "open").verdict).toBe("open");
  });

  it("closes an open window when the street becomes worse than the room, by more than the noise", () => {
    expect(rawAdvice(input({ inside: 12, outside: 12.5 }), "open").verdict).toBe("open");
    expect(rawAdvice(input({ inside: 12, outside: 14 }), "open").verdict).toBe("dont_open");
  });
});

describe("nextAdvice: the memory", () => {
  it("holds a calm change back for the minimum time, so that noise does not flip it, and lets it through after", () => {
    let r = nextAdvice(null, input({ inside: 60, outside: 5 }), 0);
    expect(r.advice.verdict).toBe("open");
    // The air inside has become good (a calm change, not an urgent one): held for ten minutes.
    r = nextAdvice(r.state, input({ inside: 8, outside: 5 }), 3 * MIN);
    expect(r.advice.verdict).toBe("open");
    expect(r.state.since).toBe(0);
    r = nextAdvice(r.state, input({ inside: 8, outside: 5 }), 11 * MIN);
    expect(r.advice.verdict).toBe("not_needed");
    expect(r.state.since).toBe(11 * MIN);
  });

  it("changes at once to 'do not open' when the street has become worse or dirty or the weather bad", () => {
    const start = nextAdvice(null, input(), 0);
    const worse = nextAdvice(start.state, input({ inside: 20, outside: 70 }), 2 * MIN);
    expect(worse.advice).toMatchObject({ verdict: "dont_open", reason: "outside_worse" });
    expect(worse.state.since).toBe(2 * MIN);
    const cold = nextAdvice(start.state, input({ outsideTemp: -20 }), 2 * MIN);
    expect(cold.advice.reason).toBe("comfort");
  });

  it("changes at once from an open window to wait when the street turns bad, and the wait is not held back", () => {
    const start = nextAdvice(null, input({ inside: 60, outside: 5 }), 0);
    expect(start.advice.verdict).toBe("open");
    const now = nextAdvice(start.state, input({ inside: 49, outside: 40, outsideForecast: [{ hours: 2, value: 12 }] }), 2 * MIN);
    expect(now.advice).toMatchObject({ verdict: "wait", waitHours: 2 });
    expect(now.state.since).toBe(2 * MIN);
  });

  it("lets a calm change through after the hold and restarts the clock", () => {
    const first = nextAdvice(null, input({ inside: 12, outside: 11 }), 0);
    expect(first.advice.verdict).toBe("dont_open");
    const later = nextAdvice(first.state, input({ inside: 60, outside: 8 }), 12 * MIN);
    expect(later.advice.verdict).toBe("open");
    expect(later.state.since).toBe(12 * MIN);
    expect(DEFAULT_SETTINGS.minHoldMinutes).toBe(10);
  });

  it("starts with the first verdict as the state", () => {
    const r = nextAdvice(null, input(), 5 * MIN);
    expect(r.state).toEqual({ verdict: "open", since: 5 * MIN });
  });
});

describe("sensitivity to the error of lambda_open (the plan requires 20 % and 50 %)", () => {
  const rows = evaluateSensitivity([-0.5, -0.2, 0.2, 0.5]);
  it("leaves the advice unchanged in almost every situation", () => {
    for (const r of rows) {
      const share = r.unchanged / r.scenarios;
      expect(share, `error ${r.error}`).toBeGreaterThanOrEqual(Math.abs(r.error) <= 0.2 ? 0.95 : 0.9);
    }
  });
});

describe("the advice against always open and never on a simulated day", () => {
  const blocks = evaluatePolicies();
  const get = (name: string, policy: string) => blocks.find((b) => b.scenario === name)!.results.find((r) => r.policy === policy)!;

  it("is never worse than keeping the window shut, in any of the scenarios", () => {
    for (const s of SCENARIOS) expect(get(s.name, "advice").meanInside, s.name).toBeLessThanOrEqual(get(s.name, "never").meanInside + 0.5);
  });

  it("does what always open does on a clean street, and keeps shut on a dirty one where always open makes it worse", () => {
    const clean = SCENARIOS[0]!.name;
    expect(get(clean, "advice").meanInside).toBeLessThan(get(clean, "never").meanInside * 0.6);
    expect(get(clean, "advice").meanInside).toBeLessThanOrEqual(get(clean, "always").meanInside + 1);
    const dirty = SCENARIOS[1]!.name;
    expect(get(dirty, "advice").meanInside).toBeLessThan(get(dirty, "always").meanInside);
    expect(get(dirty, "advice").minutesOpen).toBe(0);
  });

  it("beats both when the street gets dirty in the middle of the lesson, with the window open for less time", () => {
    const episode = SCENARIOS[2]!.name;
    expect(get(episode, "advice").meanInside).toBeLessThan(get(episode, "never").meanInside);
    expect(get(episode, "advice").meanInside).toBeLessThan(get(episode, "always").meanInside);
    expect(get(episode, "advice").minutesOpen).toBeLessThan(get(episode, "always").minutesOpen);
  });

  it("does not flicker: the state changes less than twice an hour", () => {
    for (const b of blocks) expect(get(b.scenario, "advice").switchesPerHour, b.scenario).toBeLessThan(2);
  });

  it("still holds when it believes a lambda_open half of the truth", () => {
    const wrong = evaluatePolicies({ lambdaAssumed: 4.5 });
    for (const b of wrong) {
      const never = b.results.find((r) => r.policy === "never")!;
      const advice = b.results.find((r) => r.policy === "advice")!;
      expect(advice.meanInside, b.scenario).toBeLessThanOrEqual(never.meanInside + 0.5);
    }
  });

  it("is repeatable for a seed and the noise only moves the result a little", () => {
    const a = simulateDay({ scenario: SCENARIOS[2]!, policy: "advice", seed: 1 });
    const b = simulateDay({ scenario: SCENARIOS[2]!, policy: "advice", seed: 1 });
    const c = simulateDay({ scenario: SCENARIOS[2]!, policy: "advice", seed: 2 });
    expect(a).toEqual(b);
    expect(Math.abs(a.meanInside - c.meanInside)).toBeLessThan(3);
  });
});
