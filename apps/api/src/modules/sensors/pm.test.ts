import { describe, expect, it } from "vitest";
import { SensorReadingInputSchema } from "@weather/contracts";
import { normalizePm } from "./pm.js";

describe("normalizePm", () => {
  it("keeps valid readings", () => {
    expect(normalizePm(18, 30)).toEqual({ pm25: 18, pm10: 30 });
  });

  it("treats missing values (street has no dust sensor) as null", () => {
    expect(normalizePm(undefined, undefined)).toEqual({ pm25: null, pm10: null });
  });

  it("treats the firmware's 0/0 failed-read pair as no reading", () => {
    expect(normalizePm(0, 0)).toEqual({ pm25: null, pm10: null });
  });

  it("keeps a single zero when the other value is real", () => {
    expect(normalizePm(0, 5)).toEqual({ pm25: 0, pm10: 5 });
  });

  it("drops out-of-range values one by one without rejecting the rest", () => {
    expect(normalizePm(-3, 40)).toEqual({ pm25: null, pm10: 40 });
    expect(normalizePm(20, 1001)).toEqual({ pm25: 20, pm10: null });
    expect(normalizePm(1000, 1000)).toEqual({ pm25: 1000, pm10: 1000 });
  });

  it("rounds to whole micrograms because the columns are integers", () => {
    expect(normalizePm(17.6, 30.2)).toEqual({ pm25: 18, pm10: 30 });
  });

  it("drops NaN and Infinity", () => {
    expect(normalizePm(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ pm25: null, pm10: null });
  });
});

describe("SensorReadingInputSchema with dust fields", () => {
  // Exactly what the Room sketch posts.
  const roomBody = { hum: 34.1, bmp_press: 966.2, mq5: 28, mq3: 3, pm25: 12, pm10: 19, fused_temp: 25.4 };

  it("accepts the Room firmware payload including pm25/pm10", () => {
    const parsed = SensorReadingInputSchema.parse(roomBody);
    expect(parsed).toMatchObject({ pm25: 12, pm10: 19, bmpPress: 966.2, fusedTemp: 25.4 });
  });

  it("still accepts the Street payload that has no dust fields", () => {
    const { pm25: _pm25, pm10: _pm10, ...street } = roomBody;
    const parsed = SensorReadingInputSchema.parse(street);
    expect(parsed.pm25).toBeUndefined();
    expect(parsed.pm10).toBeUndefined();
  });
});
