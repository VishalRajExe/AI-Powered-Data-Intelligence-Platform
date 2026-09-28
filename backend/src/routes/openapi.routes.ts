import { Router } from "express";
import { openApiSpecification } from "../docs/openapi.spec.js";

/**
 * Creates an Express router exposing the OpenAPI 3.1.0 specification.
 */
export function createOpenApiRouter(): Router {
  const router = Router();

  router.get("/openapi.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(openApiSpecification);
  });

  return router;
}
