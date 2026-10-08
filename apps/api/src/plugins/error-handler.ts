import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { AppError } from "@weather/contracts";

export const errorHandlerPlugin: FastifyPluginAsync = fp(async (app) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ err: error }, "handled AppError");
      reply.status(error.statusCode).send(error.toResponse());
      return;
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      request.log.info({ err: error }, "request validation failed");
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request failed validation",
          details: error.validation,
        },
      });
      return;
    }

    request.log.error({ err: error }, "unhandled error");
    reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: `Route ${request.method} ${request.url} not found` },
    });
  });
});
