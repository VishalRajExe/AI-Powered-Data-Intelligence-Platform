import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const safeRequestId = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestIdMiddleware: RequestHandler = (request, response, next) => {
  const supplied = request.header("X-Request-ID");
  const requestId = supplied && safeRequestId.test(supplied) ? supplied : randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("X-Request-ID", requestId);
  next();
};
