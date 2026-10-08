import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "INTERNAL_ERROR",
  "RANGE_TOO_LARGE",
  "UNAUTHORIZED",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export class AppError extends Error {
  code: ErrorCode;
  statusCode: number;
  details?: unknown;

  constructor(code: ErrorCode, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toResponse(): ErrorResponse {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }

  static notFound(message: string): AppError {
    return new AppError("NOT_FOUND", message, 404);
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError("VALIDATION_ERROR", message, 400, details);
  }

  static rangeTooLarge(message: string): AppError {
    return new AppError("RANGE_TOO_LARGE", message, 413);
  }

  static unauthorized(message: string): AppError {
    return new AppError("UNAUTHORIZED", message, 401);
  }
}
