import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500,
    readonly code = "INTERNAL_ERROR",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function notFoundHandler(): RequestHandler {
  return (_request, _response, next) => next(new AppError("Route not found", 404, "NOT_FOUND"));
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request: Request, response, _next) => {
    void _next;
    const requestId = response.locals.requestId as string | undefined;
    let statusCode = 500;
    let code = "INTERNAL_ERROR";
    let message = "An unexpected error occurred";
    let details: unknown;

    if (error instanceof AppError) {
      statusCode = error.statusCode;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (error instanceof ZodError) {
      statusCode = 400;
      code = "VALIDATION_ERROR";
      message = "Request validation failed";
      details = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    } else if (isMalformedJson(error)) {
      statusCode = 400;
      code = "INVALID_JSON";
      message = "Request body contains invalid JSON";
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      code = "DATABASE_ERROR";
      message = "A database operation failed";
    } else if (isOriginError(error)) {
      statusCode = 403;
      code = "ORIGIN_NOT_ALLOWED";
      message = "Request origin is not allowed";
    }

    logger.error({ err: error, requestId, method: request.method, path: request.path, code }, "Request failed");
    response.status(statusCode).json({ error: { code, message, requestId, ...(details ? { details } : {}) } });
  };
}

function isMalformedJson(error: unknown): error is SyntaxError & { status: number; body: unknown } {
  return error instanceof SyntaxError && "status" in error && error.status === 400 && "body" in error;
}

function isOriginError(error: unknown): boolean {
  return error instanceof Error && error.message === "Origin not allowed";
}
