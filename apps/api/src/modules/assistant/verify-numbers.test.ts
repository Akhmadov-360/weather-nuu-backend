import { describe, expect, it } from "vitest";
import { findUnverifiedNumbers } from "./verify-numbers.js";

const tool = JSON.stringify({ temperatureC: 24.7, humidityPercent: 38.1, pressureHpa: 962.6, pm25: { value: 48.2, aqi: 132 }, recordedAt: "2026-11-21T09:59:30.000Z" });

describe("findUnverifiedNumbers", () => {
  it("accepts numbers that the tools returned", () => {
    expect(findUnverifiedNumbers("Сейчас 24,7 °C, влажность 38,1 %, давление 962,6 гПа.", [tool], "")).toEqual([]);
  });

  it("accepts a number the model rounded", () => {
    expect(findUnverifiedNumbers("Около 25 градусов и 48 мкг/м³.", [tool], "")).toEqual([]);
    expect(findUnverifiedNumbers("PM2.5 равно 48.2, AQI 132.", [tool], "")).toEqual([]);
  });

  it("reads a decimal comma and a decimal point alike", () => {
    expect(findUnverifiedNumbers("24.7 и 24,7", [tool], "")).toEqual([]);
  });

  it("flags a number that no tool returned: a figure the model made up or calculated itself", () => {
    expect(findUnverifiedNumbers("В аудитории теплее на 15,4 °C.", [tool], "")).toEqual(["15.4"]);
  });

  it("flags a wrong number even when it is close in size", () => {
    expect(findUnverifiedNumbers("Температура 26,9 °C.", [tool], "")).toEqual(["26.9"]);
  });

  it("does not take the digits of a pollutant name or a sensor name for numbers", () => {
    expect(findUnverifiedNumbers("PM2.5, PM10, MQ-5 и MQ-3 это датчики.", [tool], "")).toEqual([]);
  });

  it("lets small whole numbers through: list numbers, hours, days", () => {
    expect(findUnverifiedNumbers("1. Температура. 2. Влажность. За последние 6 часов, за 3 дня.", [tool], "")).toEqual([]);
  });

  it("lets through numbers that the visitor wrote in the question", () => {
    expect(findUnverifiedNumbers("Да, 120 минут это два часа.", [tool], "Что будет через 120 минут?")).toEqual([]);
  });

  it("does not take times and dates for numbers", () => {
    expect(findUnverifiedNumbers("Данные на 2026-11-21 10:57:30.", [tool], "")).toEqual([]);
  });

  it("lists each wrong number once", () => {
    expect(findUnverifiedNumbers("Разница 15,4 °C, да, 15,4.", [tool], "")).toEqual(["15.4"]);
  });

  it("flags everything when there were no tool results at all", () => {
    expect(findUnverifiedNumbers("Сейчас 24,7 °C.", [], "")).toEqual(["24.7"]);
  });

  it("is quiet for an answer with no numbers", () => {
    expect(findUnverifiedNumbers("Данных пока нет.", [], "")).toEqual([]);
  });
});
