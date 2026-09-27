import { Router } from "express";
import type { RequirementParser } from "../modules/requirements/parser.service.js";
import { ParseRequirementRequestSchema, type ParseRequirementRequest } from "../modules/requirements/requirement.schema.js";
import { validateRequest } from "../common/validateRequest.js";

export function createRequirementsRouter(parser: RequirementParser): Router {
  const router = Router();

  router.post("/requirements/parse", validateRequest({ body: ParseRequirementRequestSchema }), async (_request, response) => {
    const validated = response.locals.validated as { body: ParseRequirementRequest };
    const result = await parser.parse(validated.body.prompt);
    response.status(200).json(result);
  });

  return router;
}
