import { AppError } from "@weather/contracts";

/**
 * `recordedAt` alone isn't unique — several rows can share a timestamp —
 * so a keyset cursor needs `id` as a tie-breaker to guarantee every row
 * is visited exactly once across pages. The cursor is opaque to clients:
 * they just pass back whatever `nextCursor` they were given.
 */
export type PageCursor = { recordedAt: string; id: number };

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): PageCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as PageCursor).recordedAt === "string" &&
      typeof (parsed as PageCursor).id === "number"
    ) {
      return parsed as PageCursor;
    }
  } catch {
    // falls through to the error below
  }
  throw AppError.validation("Invalid pagination cursor");
}
