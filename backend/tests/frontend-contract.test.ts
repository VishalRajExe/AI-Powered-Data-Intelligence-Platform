import request from "supertest";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { createApp } from "../src/app.js";
import { loadEnvConfig } from "../src/config/env.js";
import { MockAgentAdapter } from "../src/agent/MockAgentAdapter.js";
import { openApiSpecification } from "../src/docs/openapi.spec.js";
import type { RequirementParser } from "../src/modules/requirements/parser.service.js";
import type { WorkflowPlanner } from "../src/modules/planner/planner.service.js";
import type { WorkflowExecutionServiceContract } from "../src/modules/workflows/workflow-execution.service.js";

function createContractTestApp() {
  const config = loadEnvConfig({
    APP_ENV: "test",
    MYSQL_HOST: "localhost",
    MYSQL_PORT: "3306",
    MYSQL_USER: "aidp",
    MYSQL_PASSWORD: "",
    MYSQL_DATABASE: "aidp_test",
    JWT_ACCESS_SECRET: "test_access_secret_with_32_characters_minimum!",
    JWT_REFRESH_SECRET: "test_refresh_secret_with_32_characters_minimum!",
  });

  const logger = pino({ level: "silent" });

  return createApp({
    config,
    logger,
    readiness: { mysql: async () => {}, redis: async () => {} },
    requirementParser: {} as unknown as RequirementParser,
    workflowPlanner: {} as unknown as WorkflowPlanner,
    workflowExecution: {} as unknown as WorkflowExecutionServiceContract,
    agentAdapter: new MockAgentAdapter(),
  });
}

describe("Phase 14 — Frontend Integration Contract", () => {
  describe("1. OpenAPI 3.1.0 Endpoint Verification", () => {
    it("serves GET /api/v1/openapi.json with valid OpenAPI 3.1.0 document", async () => {
      const app = createContractTestApp();
      const res = await request(app).get("/api/v1/openapi.json");

      expect(res.status).toBe(200);
      expect(res.header["content-type"]).toContain("application/json");
      expect(res.body.openapi).toBe("3.1.0");
      expect(res.body.info.title).toContain("Scoutly");
      expect(res.body.paths).toBeDefined();
      expect(Object.keys(res.body.paths).length).toBeGreaterThanOrEqual(20);
    });

    it("verifies security schemes in OpenAPI specification", () => {
      expect(openApiSpecification.components.securitySchemes.BearerAuth).toBeDefined();
      expect(openApiSpecification.components.securitySchemes.BearerAuth.type).toBe("http");
      expect(openApiSpecification.components.securitySchemes.BearerAuth.scheme).toBe("bearer");
      expect(openApiSpecification.components.securitySchemes.WorkspaceHeader).toBeDefined();
      expect(openApiSpecification.components.securitySchemes.WorkspaceHeader.name).toBe("X-Workspace-ID");
    });
  });

  describe("2. Core Areas Coverage", () => {
    const requiredCoreAreas = [
      "Auth",
      "Requirements",
      "Workflows",
      "Runs",
      "Events",
      "Datasets",
      "Rows",
      "Sources",
      "Evidence",
      "Exports",
      "Activity",
    ];

    it.each(requiredCoreAreas)("includes core area tag: %s", (coreArea) => {
      const tagExists = openApiSpecification.tags.some(
        (t) => t.name.toLowerCase() === coreArea.toLowerCase(),
      );
      expect(tagExists).toBe(true);
    });
  });

  describe("3. Frontend Screens Mapping Verification", () => {
    it("Screen 1 (New Research Task): verifies POST /requirements/parse", () => {
      const endpoint = openApiSpecification.paths["/requirements/parse"];
      expect(endpoint).toBeDefined();
      expect(endpoint.post).toBeDefined();
      expect(endpoint.post.tags).toContain("Requirements");
      expect(endpoint.post.requestBody).toBeDefined();
      expect(endpoint.post.responses["200"]).toBeDefined();
      expect(endpoint.post.responses["400"]).toBeDefined();
      expect(endpoint.post.responses["422"]).toBeDefined();
    });

    it("Screen 2 (Workflow Preview): verifies POST /workflows/plan and POST /workflows/execute", () => {
      const planEndpoint = openApiSpecification.paths["/workflows/plan"];
      expect(planEndpoint?.post).toBeDefined();
      expect(planEndpoint.post.responses["200"]).toBeDefined();

      const executeEndpoint = openApiSpecification.paths["/workflows/execute"];
      expect(executeEndpoint?.post).toBeDefined();
      expect(executeEndpoint.post.responses["202"]).toBeDefined();
    });

    it("Screen 3 (Workflow Running): verifies SSE /runs/{id}/events, /runs/{id}, /runs/{id}/steps, and /runs/{id}/cancel", () => {
      const sseEndpoint = openApiSpecification.paths["/runs/{id}/events"];
      expect(sseEndpoint?.get).toBeDefined();
      expect(sseEndpoint.get.tags).toContain("Events");
      expect(sseEndpoint.get.responses["200"].content["text/event-stream"]).toBeDefined();

      const runEndpoint = openApiSpecification.paths["/runs/{id}"];
      expect(runEndpoint?.get).toBeDefined();

      const stepsEndpoint = openApiSpecification.paths["/runs/{id}/steps"];
      expect(stepsEndpoint?.get).toBeDefined();

      const cancelEndpoint = openApiSpecification.paths["/runs/{id}/cancel"];
      expect(cancelEndpoint?.post).toBeDefined();
      expect(cancelEndpoint.post.responses["200"]).toBeDefined();
    });

    it("Screen 4 (Workflow History): verifies GET /workflows, /workflows/{id}, and /workflows/{id}/runs", () => {
      const listWf = openApiSpecification.paths["/workflows"];
      expect(listWf?.get).toBeDefined();
      expect(listWf.get.responses["200"]).toBeDefined();

      const detailWf = openApiSpecification.paths["/workflows/{id}"];
      expect(detailWf?.get).toBeDefined();

      const runsWf = openApiSpecification.paths["/workflows/{id}/runs"];
      expect(runsWf?.get).toBeDefined();
    });

    it("Screen 5 (Dataset Explorer): verifies GET /datasets, /datasets/{id}, /datasets/{id}/schema, and /datasets/{id}/rows", () => {
      const listDs = openApiSpecification.paths["/datasets"];
      expect(listDs?.get).toBeDefined();

      const detailDs = openApiSpecification.paths["/datasets/{id}"];
      expect(detailDs?.get).toBeDefined();

      const schemaDs = openApiSpecification.paths["/datasets/{id}/schema"];
      expect(schemaDs?.get).toBeDefined();

      const rowsDs = openApiSpecification.paths["/datasets/{id}/rows"];
      expect(rowsDs?.get).toBeDefined();
    });

    it("Screen 6 (Source Explorer): verifies GET /datasets/{id}/sources, /sources/{id}, and /rows/{id}/evidence", () => {
      const sourcesDs = openApiSpecification.paths["/datasets/{id}/sources"];
      expect(sourcesDs?.get).toBeDefined();

      const sourceDetail = openApiSpecification.paths["/sources/{id}"];
      expect(sourceDetail?.get).toBeDefined();

      const evidenceRow = openApiSpecification.paths["/rows/{id}/evidence"];
      expect(evidenceRow?.get).toBeDefined();
      expect(evidenceRow.get.tags).toContain("Evidence");

      const evidenceAlias = openApiSpecification.paths["/datasets/{id}/rows/{rowId}/evidence"];
      expect(evidenceAlias?.get).toBeDefined();
    });

    it("Screen 7 (Export): verifies POST /datasets/{id}/exports, GET /exports/{id}, and GET /exports/{id}/download", () => {
      const createExport = openApiSpecification.paths["/datasets/{id}/exports"];
      expect(createExport?.post).toBeDefined();
      expect(createExport.post.responses["202"]).toBeDefined();

      const statusExport = openApiSpecification.paths["/exports/{id}"];
      expect(statusExport?.get).toBeDefined();

      const downloadExport = openApiSpecification.paths["/exports/{id}/download"];
      expect(downloadExport?.get).toBeDefined();
      expect(downloadExport.get.responses["200"].content["text/csv"]).toBeDefined();
      expect(downloadExport.get.responses["200"].content["application/json"]).toBeDefined();
      expect(downloadExport.get.responses["200"].content["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]).toBeDefined();
    });

    it("Screen 8 (Activity Log): verifies GET /runs/{id}/activity", () => {
      const activityEndpoint = openApiSpecification.paths["/runs/{id}/activity"];
      expect(activityEndpoint?.get).toBeDefined();
      expect(activityEndpoint.get.tags).toContain("Activity");
      expect(activityEndpoint.get.responses["200"]).toBeDefined();
    });
  });

  describe("4. Special Attention Invariants", () => {
    it("verifies uniform pagination format (PaginationMeta)", () => {
      const pagination = openApiSpecification.components.schemas.PaginationMeta;
      expect(pagination).toBeDefined();
      expect(pagination.required).toEqual(["page", "limit", "total", "totalPages", "hasMore"]);
      expect(pagination.properties.page.type).toBe("integer");
      expect(pagination.properties.limit.type).toBe("integer");
      expect(pagination.properties.total.type).toBe("integer");
      expect(pagination.properties.totalPages.type).toBe("integer");
      expect(pagination.properties.hasMore.type).toBe("boolean");
    });

    it("verifies dynamic dataset columns schema (DatasetColumnView)", () => {
      const colSchema = openApiSpecification.components.schemas.DatasetColumnView;
      expect(colSchema).toBeDefined();
      expect(colSchema.required).toEqual(["id", "name", "key", "type", "required", "orderIndex"]);
      expect(colSchema.properties.key.type).toBe("string");
      expect(colSchema.properties.type.enum).toContain("string");
      expect(colSchema.properties.type.enum).toContain("currency");
    });

    it("verifies dataset rows dynamic values and verification status", () => {
      const rowSchema = openApiSpecification.components.schemas.DatasetRowItem;
      expect(rowSchema).toBeDefined();
      expect(rowSchema.required).toContain("values");
      expect(rowSchema.required).toContain("verificationStatus");
      expect(rowSchema.required).toContain("confidenceScore");
      expect(rowSchema.required).toContain("sources");
      expect(rowSchema.properties.verificationStatus.enum).toEqual([
        "VERIFIED",
        "SOURCE_CITED_UNVERIFIED",
        "UNSUPPORTED",
        "CONFLICTED",
      ]);
    });

    it("verifies row evidence explorer schema and field-level citations", () => {
      const explorer = openApiSpecification.components.schemas.RowEvidenceExplorerResponse;
      expect(explorer).toBeDefined();
      expect(explorer.required).toContain("fields");
      expect(explorer.required).toContain("verificationStatus");

      const fieldView = openApiSpecification.components.schemas.FieldEvidenceView;
      expect(fieldView).toBeDefined();
      expect(fieldView.required).toEqual([
        "fieldName",
        "fieldValue",
        "isVerified",
        "confidenceScore",
        "supportingSources",
        "conflictingSources",
      ]);
      expect(fieldView.properties.isVerified.type).toBe("boolean");
    });

    it("verifies filter query parameters on /datasets/{id}/rows", () => {
      const rowsEndpoint = openApiSpecification.paths["/datasets/{id}/rows"];
      const paramNames = rowsEndpoint.get.parameters.map((p: { name: string }) => p.name);

      expect(paramNames).toContain("page");
      expect(paramNames).toContain("limit");
      expect(paramNames).toContain("search");
      expect(paramNames).toContain("validOnly");
      expect(paramNames).toContain("duplicatesOnly");
      expect(paramNames).toContain("verificationStatus");
      expect(paramNames).toContain("minConfidence");
      expect(paramNames).toContain("sourceId");
      expect(paramNames).toContain("fieldFilters");
      expect(paramNames).toContain("sortBy");
      expect(paramNames).toContain("sortOrder");
    });

    it("verifies error responses envelope format across endpoints", () => {
      const errSchema = openApiSpecification.components.schemas.ErrorResponse;
      expect(errSchema).toBeDefined();
      expect(errSchema.required).toContain("error");
      const errDetail = openApiSpecification.components.schemas.ErrorDetail;
      expect(errDetail.required).toEqual(["message", "code"]);
    });
  });
});
