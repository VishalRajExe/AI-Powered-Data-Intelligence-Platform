import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { z } from "zod";
import { AppError } from "./errors.js";

type RequestSchemas = Partial<Record<"body" | "params" | "query", z.ZodType>>;
type ValidatedRequest = Partial<Record<"body" | "params" | "query", unknown>>;

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const validated: ValidatedRequest = {};

    for (const part of ["params", "query", "body"] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(request[part]);
      if (!result.success) {
        next(new AppError("Request validation failed", 400, "VALIDATION_ERROR", result.error.issues.map((issue) => ({
          path: [part, ...issue.path].join("."),
          message: issue.message,
        }))));
        return;
      }
      validated[part] = result.data;
    }

    response.locals.validated = validated;
    next();
  };
}
