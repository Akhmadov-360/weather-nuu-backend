import { timingSafeEqual } from "node:crypto";
import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "@weather/contracts";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    requireDeviceAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch — comparing lengths first
  // is itself not constant-time, but leaking the *length* of a 32+ byte
  // secret isn't a meaningful weakening here.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Guards the device-write endpoints (POST /v1/sensors/:source,
 * POST /v1/cansat). `x-api-key` is checked, not required: older firmware
 * doesn't send it at all, and 100% backward compatibility with existing
 * devices is a hard requirement, so a request with no header is let
 * through (logged, so the rollout of updated firmware can be tracked from
 * these warnings). A request that DOES send a key still has to get it
 * right — this isn't real access control against a network attacker who
 * simply omits the header, but it still stops typos/stale keys once
 * firmware is updated, and gives a path to actually enforcing this later
 * without another breaking change.
 */
export const deviceAuthPlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorate("requireDeviceAuth", async (request: FastifyRequest) => {
    const provided = request.headers["x-api-key"];

    if (provided === undefined) {
      request.log.warn({ url: request.url }, "device write with no x-api-key — allowed for backward compatibility");
      return;
    }

    if (typeof provided !== "string" || !safeEqual(provided, env.INGEST_API_KEY)) {
      throw AppError.unauthorized("Invalid x-api-key header");
    }
  });
});
