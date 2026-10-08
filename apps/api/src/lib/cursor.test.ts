import { describe, expect, it } from "vitest";
import { AppError } from "@weather/contracts";
import { decodeCursor, encodeCursor } from "./cursor.js";

describe("cursor codec", () => {
  it("round-trips recordedAt + id", () => {
    const cursor = { recordedAt: "2024-01-01T10:00:00.000Z", id: 42 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("rejects garbage input", () => {
    expect(() => decodeCursor("not-a-cursor!!!")).toThrow(AppError);
  });

  it("rejects well-formed base64/JSON that isn't a cursor shape", () => {
    const bogus = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString("base64url");
    expect(() => decodeCursor(bogus)).toThrow(AppError);
  });
});
