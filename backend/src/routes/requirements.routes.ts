import { Router } from "express";
import type { RequirementParser } from "../modules/requirements/parser.service.js";
import { ParseRequirementRequestSchema, type ParseRequirementRequest } from "../modules/requirements/requirement.schema.js";
import { validateRequest } from "../common/validateRequest.js";

export function createRequirementsRouter(parser: RequirementParser): Router {
  const router = Router();

  router.post("/requirements/parse", validateRequest({ body: ParseRequirementRequestSchema }), async (_request, response) => {
    const validated = response.locals.validated as { body: ParseRequirementRequest };
    const result = await parser.parse(validated.body.prompt);
    const req = result.parsedRequirement;
    response.status(200).json({
      ...result,
      entity: req?.entityType || "Record",
      fields:
        req?.fields?.map((f: any) => ({
          name: f.name || f.key || f.label || "field",
          type: f.type === "string" ? "text" : f.type,
          required: req.requiredFields
            ? req.requiredFields.includes(f.key || f.name)
            : (f.required ?? true),
        })) || [],
      filters: (req?.filters || [])
        .map((fl: any) =>
          typeof fl === "string"
            ? fl
            : `${fl.field || ""} ${fl.operator || ""} ${fl.value || ""}`.trim(),
        )
        .concat(req?.constraints || []),
      sourceTypes: req?.sourcePreferences || [],
      targetCount: req?.quantity || 100,
    });
  });

  return router;
}
