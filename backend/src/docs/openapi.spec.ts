/**
 * Complete OpenAPI 3.1.0 Specification for Scoutly (AI-Powered Data Intelligence Platform).
 * Defines all backend contracts consumed by the frontend client.
 */

export const openApiSpecification = {
  openapi: "3.1.0",
  info: {
    title: "Scoutly — AI-Powered Data Intelligence Platform API",
    version: "1.0.0",
    description:
      "Comprehensive RESTful and Server-Sent Events (SSE) API contract powering the Scoutly frontend. Covers Authentication, Requirements Parsing, Workflow Planning & Execution, Live Monitoring, Dynamic Datasets, Provenance & Evidence Explorer, and Data Exports.",
    contact: {
      name: "Scoutly Engineering",
      url: "https://scoutly.ai",
    },
  },
  servers: [
    {
      url: "/api/v1",
      description: "Primary API v1 base path",
    },
  ],
  tags: [
    { name: "Auth", description: "User registration, login, JWT token rotation, revocation, and current user profile" },
    { name: "Requirements", description: "Natural language requirement parsing, entity discovery, schema formulation, and clarification" },
    { name: "Workflows", description: "Deterministic multi-step workflow planning, plan retrieval, and workflow runs" },
    { name: "Runs", description: "Workflow execution status, step timings, cancellations, and activity history" },
    { name: "Events", description: "Real-time Server-Sent Events (SSE) live execution monitoring and progress streaming" },
    { name: "Datasets", description: "Structured business dataset querying, schema definitions, and dynamic row values" },
    { name: "Rows", description: "Dynamic dataset rows with validation states, confidence scores, and source links" },
    { name: "Sources", description: "Web page sources, governance rules, HTTP status, and extracted snippets" },
    { name: "Evidence", description: "Deep field-level provenance, supporting sources, confidence scores, and conflict resolution" },
    { name: "Exports", description: "Asynchronous dataset exports in CSV, JSON, and XLSX with chunked streaming downloads" },
    { name: "Activity", description: "Tenant and run-level activity audit logs" },
    { name: "Health", description: "Service health, MySQL/Redis readiness probes, and collection engine status" },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Standard Bearer JWT access token (15-minute TTL). Passed via the `Authorization: Bearer <token>` header.",
      },
      WorkspaceHeader: {
        type: "apiKey",
        in: "header",
        name: "X-Workspace-ID",
        description: "Target workspace UUID. Optional if supplied via route parameter, query string, or user default workspace.",
      },
    },
    schemas: {
      // -------------------------------------------------------------
      // Common & Error Schemas
      // -------------------------------------------------------------
      ErrorDetail: {
        type: "object",
        required: ["message", "code"],
        properties: {
          message: { type: "string", description: "Human-readable error explanation", example: "Invalid credentials" },
          code: { type: "string", description: "Machine-readable error code", example: "INVALID_CREDENTIALS" },
          details: {
            type: "object",
            description: "Optional context or field-specific validation issues",
            additionalProperties: true,
          },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: { $ref: "#/components/schemas/ErrorDetail" },
        },
      },
      PaginationMeta: {
        type: "object",
        required: ["page", "limit", "total", "totalPages", "hasMore"],
        properties: {
          page: { type: "integer", minimum: 1, example: 1, description: "Current page index (1-based)" },
          limit: { type: "integer", minimum: 1, maximum: 100, example: 20, description: "Items per page" },
          total: { type: "integer", minimum: 0, example: 48, description: "Total matching items across all pages" },
          totalPages: { type: "integer", minimum: 0, example: 3, description: "Total number of pages" },
          hasMore: { type: "boolean", example: true, description: "True if subsequent pages exist" },
        },
      },

      // -------------------------------------------------------------
      // Auth Schemas
      // -------------------------------------------------------------
      UserView: {
        type: "object",
        required: ["id", "email", "status", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string", format: "uuid", example: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" },
          email: { type: "string", format: "email", example: "analyst@acme.ai" },
          name: { type: "string", nullable: true, example: "Jane Doe" },
          status: { type: "string", enum: ["ACTIVE", "SUSPENDED", "PENDING_VERIFICATION"], example: "ACTIVE" },
          createdAt: { type: "string", format: "date-time", example: "2026-09-28T10:00:00.000Z" },
          updatedAt: { type: "string", format: "date-time", example: "2026-09-28T10:00:00.000Z" },
        },
      },
      WorkspaceSummary: {
        type: "object",
        required: ["id", "name", "slug", "role", "status", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid", example: "c2a9a7df-13c5-430c-a991-31cb84394982" },
          name: { type: "string", example: "Acme Market Intelligence" },
          slug: { type: "string", example: "acme-market-intelligence" },
          role: { type: "string", enum: ["OWNER", "ADMIN", "MEMBER"], example: "OWNER" },
          status: { type: "string", enum: ["ACTIVE", "ARCHIVED"], example: "ACTIVE" },
          createdAt: { type: "string", format: "date-time", example: "2026-09-28T10:00:00.000Z" },
        },
      },
      AuthTokens: {
        type: "object",
        required: ["accessToken", "refreshToken", "tokenType", "expiresIn"],
        properties: {
          accessToken: { type: "string", description: "Short-lived JWT (15-minute TTL)", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
          refreshToken: { type: "string", description: "Cryptographically tracked refresh token (7-day TTL)", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
          tokenType: { type: "string", enum: ["Bearer"], example: "Bearer" },
          expiresIn: { type: "integer", description: "Access token expiration in seconds", example: 900 },
        },
      },
      RegisterRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "analyst@acme.ai" },
          password: { type: "string", minLength: 8, example: "SecretP@ssword123!" },
          name: { type: "string", example: "Jane Doe" },
          workspaceName: { type: "string", example: "Acme Market Intelligence" },
        },
      },
      RegisterResponse: {
        type: "object",
        required: ["user", "workspaces", "tokens"],
        properties: {
          user: { $ref: "#/components/schemas/UserView" },
          workspaces: { type: "array", items: { $ref: "#/components/schemas/WorkspaceSummary" } },
          tokens: { $ref: "#/components/schemas/AuthTokens" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "analyst@acme.ai" },
          password: { type: "string", example: "SecretP@ssword123!" },
        },
      },
      LoginResponse: {
        type: "object",
        required: ["user", "workspaces", "tokens"],
        properties: {
          user: { $ref: "#/components/schemas/UserView" },
          workspaces: { type: "array", items: { $ref: "#/components/schemas/WorkspaceSummary" } },
          tokens: { $ref: "#/components/schemas/AuthTokens" },
        },
      },
      RefreshTokenRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
        },
      },
      LogoutRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
        },
      },
      LogoutResponse: {
        type: "object",
        required: ["success", "message"],
        properties: {
          success: { type: "boolean", example: true },
          message: { type: "string", example: "Successfully logged out" },
        },
      },
      CurrentUserResponse: {
        type: "object",
        required: ["user", "workspaces"],
        properties: {
          user: { $ref: "#/components/schemas/UserView" },
          workspaces: { type: "array", items: { $ref: "#/components/schemas/WorkspaceSummary" } },
        },
      },

      // -------------------------------------------------------------
      // Requirements Schemas
      // -------------------------------------------------------------
      RequirementField: {
        type: "object",
        required: ["name", "type", "required", "description"],
        properties: {
          name: { type: "string", example: "company_name" },
          type: { type: "string", enum: ["string", "number", "boolean", "date", "url", "email", "currency"], example: "string" },
          required: { type: "boolean", example: true },
          description: { type: "string", example: "Official brand or registered company name" },
        },
      },
      RequirementDefinition: {
        type: "object",
        required: ["entity", "objective", "fields"],
        properties: {
          entity: { type: "string", example: "AI Startup" },
          objective: { type: "string", example: "Collect AI companies in Berlin with funding and key executives" },
          fields: { type: "array", items: { $ref: "#/components/schemas/RequirementField" } },
          constraints: {
            type: "object",
            properties: {
              geographic: { type: "array", items: { type: "string" }, example: ["Berlin", "Germany"] },
              sampleLimit: { type: "integer", example: 50 },
            },
          },
        },
      },
      ParseRequirementsRequest: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", minLength: 3, example: "Find top 50 AI companies in Berlin with funding and founders" },
          workspaceId: { type: "string", format: "uuid", nullable: true },
        },
      },
      ParseRequirementsResponse: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["ready", "needs_clarification"], example: "ready" },
          requirement: { $ref: "#/components/schemas/RequirementDefinition" },
          clarificationQuestions: {
            type: "array",
            items: { type: "string" },
            example: ["Should we restrict only to venture-backed startups?"],
          },
        },
      },

      // -------------------------------------------------------------
      // Workflow Schemas
      // -------------------------------------------------------------
      WorkflowStepDefinition: {
        type: "object",
        required: ["id", "name", "type", "tool"],
        properties: {
          id: { type: "string", example: "step-1" },
          name: { type: "string", example: "Search target companies" },
          type: { type: "string", enum: ["SEARCH", "SCRAPE", "INTERACT", "EXTRACT", "TRANSFORM", "VALIDATE", "DEDUPLICATE", "SAVE", "EXPORT"], example: "SEARCH" },
          tool: { type: "string", enum: ["search", "scrape", "interact", "extract", "transform", "validate", "deduplicate", "save", "export"], example: "search" },
          dependsOn: { type: "array", items: { type: "string" }, example: [] },
          params: { type: "object", additionalProperties: true, example: { "query": "AI companies Berlin" } },
        },
      },
      SourcePolicy: {
        type: "object",
        properties: {
          allowedDomains: { type: "array", items: { type: "string" }, example: [] },
          blockedDomains: { type: "array", items: { type: "string" }, example: ["spam.com", "aggregators.com"] },
          maxSources: { type: "integer", example: 25 },
        },
      },
      PlanDefinition: {
        type: "object",
        required: ["version", "steps"],
        properties: {
          version: { type: "integer", example: 1 },
          steps: { type: "array", items: { $ref: "#/components/schemas/WorkflowStepDefinition" } },
          sourcePolicy: { $ref: "#/components/schemas/SourcePolicy" },
          completionCriteria: { type: "object", additionalProperties: true },
        },
      },
      CreateWorkflowPlanRequest: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", example: "Find top 50 AI companies in Berlin" },
          workspaceId: { type: "string", format: "uuid" },
          createdById: { type: "string", format: "uuid" },
        },
      },
      CreateWorkflowPlanResponse: {
        type: "object",
        required: ["workflowId", "planVersion", "plan"],
        properties: {
          workflowId: { type: "string", format: "uuid", example: "4a7199c0-fd0e-4a6c-9494-11883be71261" },
          planVersion: { type: "integer", example: 1 },
          requirement: { $ref: "#/components/schemas/RequirementDefinition" },
          plan: { $ref: "#/components/schemas/PlanDefinition" },
        },
      },
      ExecuteWorkflowRequest: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", example: "Find top 50 AI companies in Berlin" },
          workspaceId: { type: "string", format: "uuid" },
          createdById: { type: "string", format: "uuid" },
        },
      },
      ExecuteWorkflowResponse: {
        type: "object",
        required: ["workflowId", "runId", "status", "message"],
        properties: {
          workflowId: { type: "string", format: "uuid", example: "4a7199c0-fd0e-4a6c-9494-11883be71261" },
          runId: { type: "string", format: "uuid", example: "8e73428d-29c8-472b-8762-5b9487c6f059" },
          status: { type: "string", enum: ["QUEUED"], example: "QUEUED" },
          message: { type: "string", example: "Workflow created, planned, and queued for execution" },
        },
      },
      RunWorkflowRequest: {
        type: "object",
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          requestedById: { type: "string", format: "uuid" },
        },
      },
      RunWorkflowResponse: {
        type: "object",
        required: ["runId", "workflowId", "status"],
        properties: {
          runId: { type: "string", format: "uuid", example: "8e73428d-29c8-472b-8762-5b9487c6f059" },
          workflowId: { type: "string", format: "uuid", example: "4a7199c0-fd0e-4a6c-9494-11883be71261" },
          status: { type: "string", enum: ["QUEUED"], example: "QUEUED" },
        },
      },
      WorkflowSummaryItem: {
        type: "object",
        required: ["id", "workspaceId", "name", "originalPrompt", "status", "planningStatus", "createdAt", "updatedAt", "runsCount"],
        properties: {
          id: { type: "string", format: "uuid", example: "4a7199c0-fd0e-4a6c-9494-11883be71261" },
          workspaceId: { type: "string", format: "uuid", example: "c2a9a7df-13c5-430c-a991-31cb84394982" },
          name: { type: "string", example: "Berlin AI Startups Collection" },
          originalPrompt: { type: "string", example: "Find top 50 AI companies in Berlin" },
          status: { type: "string", enum: ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "FAILED"], example: "COMPLETED" },
          planningStatus: { type: "string", enum: ["NOT_STARTED", "PLANNING", "PLANNED", "FAILED"], example: "PLANNED" },
          createdAt: { type: "string", format: "date-time", example: "2026-09-28T10:00:00.000Z" },
          updatedAt: { type: "string", format: "date-time", example: "2026-09-28T10:15:00.000Z" },
          runsCount: { type: "integer", example: 3 },
          lastRun: {
            type: "object",
            nullable: true,
            properties: {
              id: { type: "string", format: "uuid" },
              status: { type: "string", enum: ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] },
              startedAt: { type: "string", format: "date-time" },
              completedAt: { type: "string", format: "date-time", nullable: true },
            },
          },
          dataset: {
            type: "object",
            nullable: true,
            properties: {
              id: { type: "string", format: "uuid" },
              name: { type: "string" },
              recordCount: { type: "integer" },
              validRecordCount: { type: "integer" },
            },
          },
        },
      },
      WorkflowListResponse: {
        type: "object",
        required: ["workflows", "pagination"],
        properties: {
          workflows: { type: "array", items: { $ref: "#/components/schemas/WorkflowSummaryItem" } },
          pagination: { $ref: "#/components/schemas/PaginationMeta" },
        },
      },
      WorkflowDetailResponse: {
        type: "object",
        required: ["workflow"],
        properties: {
          workflow: {
            allOf: [
              { $ref: "#/components/schemas/WorkflowSummaryItem" },
              {
                type: "object",
                properties: {
                  plan: { $ref: "#/components/schemas/PlanDefinition" },
                },
              },
            ],
          },
        },
      },

      // -------------------------------------------------------------
      // Runs & Steps Schemas
      // -------------------------------------------------------------
      WorkflowStepExecutionView: {
        type: "object",
        required: ["id", "stepId", "name", "type", "tool", "status", "startedAt", "attemptCount"],
        properties: {
          id: { type: "string", format: "uuid", example: "39726839-fd0e-4361-b751-bb386c968f29" },
          stepId: { type: "string", example: "step-1" },
          name: { type: "string", example: "Search target companies" },
          type: { type: "string", example: "SEARCH" },
          tool: { type: "string", example: "search" },
          status: { type: "string", enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED", "SKIPPED"], example: "COMPLETED" },
          startedAt: { type: "string", format: "date-time", example: "2026-09-28T10:02:00.000Z" },
          completedAt: { type: "string", format: "date-time", nullable: true, example: "2026-09-28T10:02:45.000Z" },
          durationMs: { type: "integer", nullable: true, example: 45000 },
          attemptCount: { type: "integer", example: 1 },
          sourceIds: { type: "array", items: { type: "string" }, example: ["uuid-source-1"] },
          outputSummary: { type: "object", additionalProperties: true, example: { "candidatesDiscovered": 18 } },
          error: { type: "string", nullable: true },
        },
      },
      WorkflowRunView: {
        type: "object",
        required: ["id", "workflowId", "status", "startedAt", "recordsFound", "recordsAccepted", "duplicatesCount", "failuresCount", "sourceCount", "steps"],
        properties: {
          id: { type: "string", format: "uuid", example: "8e73428d-29c8-472b-8762-5b9487c6f059" },
          workflowId: { type: "string", format: "uuid", example: "4a7199c0-fd0e-4a6c-9494-11883be71261" },
          status: { type: "string", enum: ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"], example: "COMPLETED" },
          startedAt: { type: "string", format: "date-time", example: "2026-09-28T10:01:00.000Z" },
          completedAt: { type: "string", format: "date-time", nullable: true, example: "2026-09-28T10:06:30.000Z" },
          durationMs: { type: "integer", nullable: true, example: 330000 },
          recordsFound: { type: "integer", example: 52 },
          recordsAccepted: { type: "integer", example: 48 },
          duplicatesCount: { type: "integer", example: 4 },
          failuresCount: { type: "integer", example: 0 },
          sourceCount: { type: "integer", example: 14 },
          dataset: {
            type: "object",
            nullable: true,
            properties: {
              id: { type: "string", format: "uuid" },
              name: { type: "string" },
            },
          },
          steps: { type: "array", items: { $ref: "#/components/schemas/WorkflowStepExecutionView" } },
        },
      },
      WorkflowRunListResponse: {
        type: "object",
        required: ["runs", "pagination"],
        properties: {
          runs: { type: "array", items: { $ref: "#/components/schemas/WorkflowRunView" } },
          pagination: { $ref: "#/components/schemas/PaginationMeta" },
        },
      },
      RunStepsResponse: {
        type: "object",
        required: ["runId", "steps"],
        properties: {
          runId: { type: "string", format: "uuid", example: "8e73428d-29c8-472b-8762-5b9487c6f059" },
          steps: { type: "array", items: { $ref: "#/components/schemas/WorkflowStepExecutionView" } },
        },
      },
      CancelRunResponse: {
        type: "object",
        required: ["runId", "status", "message"],
        properties: {
          runId: { type: "string", format: "uuid", example: "8e73428d-29c8-472b-8762-5b9487c6f059" },
          status: { type: "string", enum: ["CANCELLED"], example: "CANCELLED" },
          message: { type: "string", example: "Cancellation requested" },
        },
      },

      // -------------------------------------------------------------
      // Activity & SSE Events Schemas
      // -------------------------------------------------------------
      ActivityEventView: {
        type: "object",
        required: ["id", "workspaceId", "runId", "workflowId", "action", "entityType", "entityId", "description", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid", example: "71cb294a-9b1d-4054-9549-33d7b889d1b5" },
          workspaceId: { type: "string", format: "uuid", example: "c2a9a7df-13c5-430c-a991-31cb84394982" },
          runId: { type: "string", format: "uuid", example: "8e73428d-29c8-472b-8762-5b9487c6f059" },
          workflowId: { type: "string", format: "uuid", example: "4a7199c0-fd0e-4a6c-9494-11883be71261" },
          action: {
            type: "string",
            enum: [
              "PLANNING_STARTED",
              "PLAN_CREATED",
              "SOURCE_DISCOVERY_STARTED",
              "SOURCE_DISCOVERED",
              "SCRAPE_STARTED",
              "SCRAPE_COMPLETED",
              "EXTRACTION_STARTED",
              "RECORDS_EXTRACTED",
              "VALIDATION_COMPLETED",
              "DEDUPLICATION_COMPLETED",
              "DATASET_CREATED",
              "RUN_COMPLETED",
              "RUN_FAILED",
              "RUN_CANCELLED",
            ],
            example: "RECORDS_EXTRACTED",
          },
          entityType: { type: "string", enum: ["WORKFLOW", "WORKFLOW_RUN", "SOURCE", "DATASET", "STEP"], example: "WORKFLOW_RUN" },
          entityId: { type: "string", example: "8e73428d-29c8-472b-8762-5b9487c6f059" },
          description: { type: "string", example: "Extracted 50 candidate entities from crawled sources" },
          metadata: { type: "object", additionalProperties: true, example: { "recordCount": 50 } },
          createdAt: { type: "string", format: "date-time", example: "2026-09-28T10:04:15.000Z" },
        },
      },
      RunActivityResponse: {
        type: "object",
        required: ["runId", "events"],
        properties: {
          runId: { type: "string", format: "uuid", example: "8e73428d-29c8-472b-8762-5b9487c6f059" },
          events: { type: "array", items: { $ref: "#/components/schemas/ActivityEventView" } },
        },
      },

      // -------------------------------------------------------------
      // Datasets & Dynamic Columns Schemas
      // -------------------------------------------------------------
      DatasetColumnView: {
        type: "object",
        required: ["id", "name", "key", "type", "required", "orderIndex"],
        properties: {
          id: { type: "string", format: "uuid", example: "1a8b9c0d-2e3f-4a5b-6c7d-8e9f0a1b2c3d" },
          name: { type: "string", example: "Company Name" },
          key: { type: "string", example: "company_name" },
          type: { type: "string", enum: ["string", "number", "boolean", "date", "url", "email", "currency"], example: "string" },
          description: { type: "string", nullable: true, example: "Registered business name" },
          required: { type: "boolean", example: true },
          orderIndex: { type: "integer", example: 0 },
        },
      },
      DatasetSummaryItem: {
        type: "object",
        required: ["id", "workspaceId", "workflowId", "workflowRunId", "name", "recordCount", "validRecordCount", "duplicateCount", "sourceCount", "columns", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string", format: "uuid", example: "e9f0a1b2-c3d4-4e5f-6a7b-8c9d0e1f2a3b" },
          workspaceId: { type: "string", format: "uuid", example: "c2a9a7df-13c5-430c-a991-31cb84394982" },
          workflowId: { type: "string", format: "uuid", example: "4a7199c0-fd0e-4a6c-9494-11883be71261" },
          workflowRunId: { type: "string", format: "uuid", example: "8e73428d-29c8-472b-8762-5b9487c6f059" },
          name: { type: "string", example: "Berlin AI Startups 2026" },
          description: { type: "string", nullable: true, example: "Top 50 AI companies extracted from web evidence" },
          originalPrompt: { type: "string", example: "Find top 50 AI companies in Berlin" },
          recordCount: { type: "integer", example: 50 },
          validRecordCount: { type: "integer", example: 48 },
          duplicateCount: { type: "integer", example: 2 },
          sourceCount: { type: "integer", example: 14 },
          columns: { type: "array", items: { $ref: "#/components/schemas/DatasetColumnView" } },
          createdAt: { type: "string", format: "date-time", example: "2026-09-28T10:06:00.000Z" },
          updatedAt: { type: "string", format: "date-time", example: "2026-09-28T10:06:00.000Z" },
        },
      },
      DatasetListResponse: {
        type: "object",
        required: ["items", "pagination"],
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/DatasetSummaryItem" } },
          pagination: { $ref: "#/components/schemas/PaginationMeta" },
        },
      },
      DatasetSchemaResponse: {
        type: "object",
        required: ["datasetId", "columns"],
        properties: {
          datasetId: { type: "string", format: "uuid", example: "e9f0a1b2-c3d4-4e5f-6a7b-8c9d0e1f2a3b" },
          columns: { type: "array", items: { $ref: "#/components/schemas/DatasetColumnView" } },
        },
      },

      // -------------------------------------------------------------
      // Rows & Dynamic Values Schemas
      // -------------------------------------------------------------
      DatasetRowSourceReference: {
        type: "object",
        required: ["id", "url", "domain", "title"],
        properties: {
          id: { type: "string", format: "uuid", example: "71cb294a-9b1d-4054-9549-33d7b889d1b5" },
          url: { type: "string", format: "uri", example: "https://alpha.ai" },
          domain: { type: "string", example: "alpha.ai" },
          title: { type: "string", example: "Alpha AI — Autonomous Intelligence" },
        },
      },
      DatasetRowItem: {
        type: "object",
        required: ["id", "datasetId", "rowNumber", "values", "isValid", "isDuplicate", "verificationStatus", "confidenceScore", "evidenceCount", "sourceCount", "sources", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid", example: "6d7e8f9a-0b1c-4d2e-3f4a-5b6c7d8e9f0a" },
          datasetId: { type: "string", format: "uuid", example: "e9f0a1b2-c3d4-4e5f-6a7b-8c9d0e1f2a3b" },
          rowNumber: { type: "integer", example: 1 },
          values: {
            type: "object",
            description: "Dynamic key-value pairs corresponding to DatasetColumn schema keys",
            example: {
              "company_name": "Alpha AI",
              "founders": "Max Mustermann, Sarah Connor",
              "funding_amount": "€12,000,000",
              "website": "https://alpha.ai",
            },
          },
          rawValues: {
            type: "object",
            nullable: true,
            description: "Un-normalized raw string extractions prior to cleaning",
          },
          isValid: { type: "boolean", example: true },
          isDuplicate: { type: "boolean", example: false },
          canonicalRowId: { type: "string", format: "uuid", nullable: true, example: null },
          verificationStatus: {
            type: "string",
            enum: ["VERIFIED", "SOURCE_CITED_UNVERIFIED", "UNSUPPORTED", "CONFLICTED"],
            example: "SOURCE_CITED_UNVERIFIED",
          },
          confidenceScore: { type: "number", minimum: 0, maximum: 1, example: 0.95 },
          evidenceCount: { type: "integer", example: 3 },
          sourceCount: { type: "integer", example: 2 },
          sources: { type: "array", items: { $ref: "#/components/schemas/DatasetRowSourceReference" } },
          createdAt: { type: "string", format: "date-time", example: "2026-09-28T10:06:10.000Z" },
        },
      },
      DatasetRowsListResponse: {
        type: "object",
        required: ["items", "pagination"],
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/DatasetRowItem" } },
          pagination: { $ref: "#/components/schemas/PaginationMeta" },
        },
      },

      // -------------------------------------------------------------
      // Sources & Evidence Explorer Schemas
      // -------------------------------------------------------------
      DatasetSourceItem: {
        type: "object",
        required: ["id", "workspaceId", "url", "domain", "title", "sourceType", "status", "retrievedAt", "evidenceCount", "rowsCount"],
        properties: {
          id: { type: "string", format: "uuid", example: "71cb294a-9b1d-4054-9549-33d7b889d1b5" },
          workspaceId: { type: "string", format: "uuid", example: "c2a9a7df-13c5-430c-a991-31cb84394982" },
          url: { type: "string", format: "uri", example: "https://alpha.ai/about" },
          domain: { type: "string", example: "alpha.ai" },
          title: { type: "string", example: "About Alpha AI — Leadership & Investors" },
          sourceType: { type: "string", enum: ["WEB_PAGE", "ARTICLE", "REGISTRY", "SEARCH_RESULT"], example: "WEB_PAGE" },
          status: { type: "string", enum: ["ALLOWED", "QUEUED", "PROCESSING", "COLLECTED", "FETCHED", "BLOCKED", "FAILED"], example: "COLLECTED" },
          retrievedAt: { type: "string", format: "date-time", example: "2026-09-28T10:03:00.000Z" },
          evidenceCount: { type: "integer", example: 4 },
          rowsCount: { type: "integer", example: 1 },
        },
      },
      DatasetSourcesListResponse: {
        type: "object",
        required: ["items", "pagination"],
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/DatasetSourceItem" } },
          pagination: { $ref: "#/components/schemas/PaginationMeta" },
        },
      },
      EvidenceSnippet: {
        type: "object",
        required: ["id", "snippet", "retrievedAt"],
        properties: {
          id: { type: "string", format: "uuid", example: "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d" },
          extractionStepId: { type: "string", nullable: true, example: "step-3" },
          snippet: { type: "string", example: "Alpha AI was co-founded by Max Mustermann and raised €12M in Series A funding." },
          retrievedAt: { type: "string", format: "date-time", example: "2026-09-28T10:03:15.000Z" },
        },
      },
      SourceDetailView: {
        type: "object",
        required: ["id", "workspaceId", "workflowRunId", "url", "normalizedUrl", "domain", "title", "sourceType", "status", "attemptCount", "retrievedAt", "evidenceSnippets"],
        properties: {
          id: { type: "string", format: "uuid", example: "71cb294a-9b1d-4054-9549-33d7b889d1b5" },
          workspaceId: { type: "string", format: "uuid", example: "c2a9a7df-13c5-430c-a991-31cb84394982" },
          workflowRunId: { type: "string", format: "uuid", example: "8e73428d-29c8-472b-8762-5b9487c6f059" },
          url: { type: "string", format: "uri", example: "https://alpha.ai/about" },
          normalizedUrl: { type: "string", format: "uri", example: "https://alpha.ai/about" },
          domain: { type: "string", example: "alpha.ai" },
          title: { type: "string", example: "About Alpha AI — Leadership & Investors" },
          sourceType: { type: "string", example: "WEB_PAGE" },
          status: { type: "string", example: "COLLECTED" },
          policyReason: { type: "string", nullable: true, example: "ALLOWED" },
          robotsReason: { type: "string", nullable: true, example: "ALLOWED" },
          attemptCount: { type: "integer", example: 1 },
          retrievedAt: { type: "string", format: "date-time", example: "2026-09-28T10:03:00.000Z" },
          metadata: { type: "object", additionalProperties: true, example: { "httpStatus": 200 } },
          evidenceSnippets: { type: "array", items: { $ref: "#/components/schemas/EvidenceSnippet" } },
        },
      },
      SupportingSourceView: {
        type: "object",
        required: ["sourceId", "url", "domain", "title", "snippet", "retrievedAt", "sourceType", "status"],
        properties: {
          sourceId: { type: "string", format: "uuid", example: "71cb294a-9b1d-4054-9549-33d7b889d1b5" },
          url: { type: "string", format: "uri", example: "https://alpha.ai" },
          domain: { type: "string", example: "alpha.ai" },
          title: { type: "string", example: "Alpha AI Homepage" },
          snippet: { type: "string", example: "Alpha AI is headquartered in Berlin, Germany." },
          retrievedAt: { type: "string", format: "date-time", example: "2026-09-28T10:03:00.000Z" },
          sourceType: { type: "string", example: "WEB_PAGE" },
          status: { type: "string", example: "COLLECTED" },
        },
      },
      FieldEvidenceView: {
        type: "object",
        required: ["fieldName", "fieldValue", "isVerified", "confidenceScore", "supportingSources", "conflictingSources"],
        properties: {
          fieldName: { type: "string", example: "company_name" },
          fieldValue: { type: "string", example: "Alpha AI" },
          isVerified: { type: "boolean", description: "True if snippet explicitly supports the extracted value", example: true },
          confidenceScore: { type: "number", minimum: 0, maximum: 1, example: 0.98 },
          supportingSources: { type: "array", items: { $ref: "#/components/schemas/SupportingSourceView" } },
          conflictingSources: {
            type: "array",
            items: {
              type: "object",
              required: ["sourceId", "conflictingValue", "sourceUrl"],
              properties: {
                sourceId: { type: "string", format: "uuid" },
                conflictingValue: { type: "string" },
                sourceUrl: { type: "string", format: "uri" },
                snippet: { type: "string" },
              },
            },
            example: [],
          },
        },
      },
      RowEvidenceExplorerResponse: {
        type: "object",
        required: ["rowId", "datasetId", "rowNumber", "verificationStatus", "confidenceScore", "fields", "validationIssues", "deduplicationDecisions"],
        properties: {
          rowId: { type: "string", format: "uuid", example: "6d7e8f9a-0b1c-4d2e-3f4a-5b6c7d8e9f0a" },
          datasetId: { type: "string", format: "uuid", example: "e9f0a1b2-c3d4-4e5f-6a7b-8c9d0e1f2a3b" },
          rowNumber: { type: "integer", example: 1 },
          verificationStatus: {
            type: "string",
            enum: ["VERIFIED", "SOURCE_CITED_UNVERIFIED", "UNSUPPORTED", "CONFLICTED"],
            example: "SOURCE_CITED_UNVERIFIED",
          },
          confidenceScore: { type: "number", example: 0.95 },
          fields: { type: "array", items: { $ref: "#/components/schemas/FieldEvidenceView" } },
          validationIssues: {
            type: "array",
            items: {
              type: "object",
              required: ["field", "issue", "severity"],
              properties: {
                field: { type: "string" },
                issue: { type: "string" },
                severity: { type: "string", enum: ["ERROR", "WARNING"] },
              },
            },
            example: [],
          },
          deduplicationDecisions: {
            type: "array",
            items: {
              type: "object",
              required: ["decisionType", "reason"],
              properties: {
                decisionType: { type: "string", enum: ["MERGED", "RETAINED_UNIQUE", "FLAGGED_DUPLICATE"] },
                reason: { type: "string" },
              },
            },
            example: [],
          },
        },
      },

      // -------------------------------------------------------------
      // Exports Schemas
      // -------------------------------------------------------------
      ExportFileMetadata: {
        type: "object",
        required: ["filename", "sizeBytes", "rowCount", "columnCount", "contentType", "sha256", "generatedAt"],
        properties: {
          filename: { type: "string", example: "berlin-ai-startups-2026-09-28.csv" },
          sizeBytes: { type: "integer", example: 12480 },
          rowCount: { type: "integer", example: 48 },
          columnCount: { type: "integer", example: 4 },
          contentType: { type: "string", example: "text/csv" },
          sha256: { type: "string", example: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92" },
          generatedAt: { type: "string", format: "date-time", example: "2026-09-28T10:10:00.000Z" },
        },
      },
      ExportFilterDefinition: {
        type: "object",
        properties: {
          search: { type: "string", example: "Biotech" },
          validOnly: { type: "boolean", example: true },
          duplicatesOnly: { type: "boolean", example: false },
          verificationStatus: { type: "string", enum: ["VERIFIED", "SOURCE_CITED_UNVERIFIED", "UNSUPPORTED", "CONFLICTED"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          sourceId: { type: "string", format: "uuid" },
          fieldFilters: { type: "object", additionalProperties: { type: "string" } },
          sortBy: { type: "string", example: "company_name" },
          sortOrder: { type: "string", enum: ["asc", "desc"], example: "asc" },
        },
      },
      CreateExportRequest: {
        type: "object",
        required: ["format"],
        properties: {
          format: { type: "string", enum: ["CSV", "JSON", "XLSX"], example: "CSV" },
          columns: {
            type: "array",
            items: { type: "string" },
            description: "Subset of column keys to export. If omitted, exports all dataset columns.",
            example: ["company_name", "founders", "funding_amount", "website"],
          },
          filterDefinition: { $ref: "#/components/schemas/ExportFilterDefinition" },
        },
      },
      ExportJobView: {
        type: "object",
        required: ["id", "datasetId", "workspaceId", "format", "status", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid", example: "5c6d7e8f-9a0b-1c2d-3e4f-5a6b7c8d9e0f" },
          datasetId: { type: "string", format: "uuid", example: "e9f0a1b2-c3d4-4e5f-6a7b-8c9d0e1f2a3b" },
          workspaceId: { type: "string", format: "uuid", example: "c2a9a7df-13c5-430c-a991-31cb84394982" },
          format: { type: "string", enum: ["CSV", "JSON", "XLSX"], example: "CSV" },
          status: { type: "string", enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED"], example: "COMPLETED" },
          filterDefinition: { $ref: "#/components/schemas/ExportFilterDefinition" },
          createdAt: { type: "string", format: "date-time", example: "2026-09-28T10:09:00.000Z" },
          completedAt: { type: "string", format: "date-time", nullable: true, example: "2026-09-28T10:09:12.000Z" },
          error: { type: "string", nullable: true, example: null },
          fileMetadata: { $ref: "#/components/schemas/ExportFileMetadata" },
        },
      },
    },
  },
  paths: {
    // =========================================================================
    // 1. AUTH ENDPOINTS
    // =========================================================================
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register new user and provision default workspace",
        description: "Creates user account with bcrypt password hashing, provisions an active workspace with OWNER role, and issues access/refresh tokens. Password hashes are never returned.",
        operationId: "register",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterRequest" } } },
        },
        responses: {
          "201": {
            description: "Account created successfully",
            content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterResponse" } } },
          },
          "400": { description: "Invalid input or password too short", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "409": { description: "Email already registered (EMAIL_ALREADY_EXISTS)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Authenticate user and issue JWT token pair",
        description: "Verifies user credentials via bcrypt constant-time comparison and returns signed JWT access/refresh tokens along with workspace summaries.",
        operationId: "login",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } },
        },
        responses: {
          "200": {
            description: "Login successful",
            content: { "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } } },
          },
          "400": { description: "Missing email or password", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "401": { description: "Invalid credentials (INVALID_CREDENTIALS)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "403": { description: "Account suspended or inactive", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Rotate access and refresh tokens",
        description: "Validates incoming refresh token cryptographic signature and revocation state, checks account status, and issues fresh token pair.",
        operationId: "refreshToken",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshTokenRequest" } } },
        },
        responses: {
          "200": {
            description: "Tokens successfully rotated",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AuthTokens" } } },
          },
          "400": { description: "Missing refreshToken in request", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "401": { description: "Token invalid, expired, or revoked (TOKEN_REVOKED)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Revoke refresh token and terminate session",
        description: "Revokes the cryptographic `jti` in Redis / in-memory revocation registry, preventing further token refreshes.",
        operationId: "logout",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LogoutRequest" } } },
        },
        responses: {
          "200": {
            description: "Session successfully terminated",
            content: { "application/json": { schema: { $ref: "#/components/schemas/LogoutResponse" } } },
          },
          "400": { description: "Missing refreshToken parameter", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Get current authenticated user profile and workspaces",
        description: "Returns sanitized user profile (strictly omitting password hashes) and active workspace memberships for the authenticated principal.",
        operationId: "getCurrentUser",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Profile and workspace list",
            content: { "application/json": { schema: { $ref: "#/components/schemas/CurrentUserResponse" } } },
          },
          "401": { description: "Unauthenticated or invalid/expired token", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "404": { description: "User record no longer exists", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },

    // =========================================================================
    // 2. REQUIREMENTS ENDPOINTS (Screen 1: New Research Task)
    // =========================================================================
    "/requirements/parse": {
      post: {
        tags: ["Requirements"],
        summary: "Parse natural language prompt into structured requirement",
        description: "Analyzes prompt intent, extracts target entity, derives required/optional schema fields, and detects ambiguities. If clarification is needed, returns `needs_clarification` with questions.",
        operationId: "parseRequirements",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ParseRequirementsRequest" } } },
        },
        responses: {
          "200": {
            description: "Structured requirement or clarification questions",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ParseRequirementsResponse" } } },
          },
          "400": { description: "Invalid prompt or schema violation", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "422": { description: "Unprocessable or empty prompt", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },

    // =========================================================================
    // 3. WORKFLOWS ENDPOINTS (Screen 2: Workflow Preview & Screen 4: History)
    // =========================================================================
    "/workflows/plan": {
      post: {
        tags: ["Workflows"],
        summary: "Generate deterministic execution plan for a requirement",
        description: "Creates a versioned workflow plan with dependency-ordered steps (SEARCH, SCRAPE, EXTRACT, VALIDATE, SAVE), tool parameter bindings, and domain policies without running collection.",
        operationId: "createWorkflowPlan",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateWorkflowPlanRequest" } } },
        },
        responses: {
          "200": {
            description: "Generated workflow plan",
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateWorkflowPlanResponse" } } },
          },
          "400": { description: "Invalid prompt or missing workspace ID", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "401": { description: "Authentication required", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "403": { description: "Workspace access denied or user mismatch", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/workflows/execute": {
      post: {
        tags: ["Workflows"],
        summary: "Plan and enqueue workflow for immediate execution",
        description: "Combines requirement parsing, workflow planning, and BullMQ background queue dispatch in a single atomic invocation.",
        operationId: "executeWorkflow",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ExecuteWorkflowRequest" } } },
        },
        responses: {
          "202": {
            description: "Workflow planned and queued in BullMQ",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ExecuteWorkflowResponse" } } },
          },
          "400": { description: "Invalid prompt or parameters", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "403": { description: "Workspace access denied", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/workflows/{id}/run": {
      post: {
        tags: ["Workflows"],
        summary: "Execute existing planned workflow",
        description: "Enqueues a new execution run for an existing saved workflow plan.",
        operationId: "runWorkflow",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, description: "Workflow UUID", schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/RunWorkflowRequest" } } },
        },
        responses: {
          "202": {
            description: "Workflow run enqueued",
            content: { "application/json": { schema: { $ref: "#/components/schemas/RunWorkflowResponse" } } },
          },
          "404": { description: "Workflow not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/workflows": {
      get: {
        tags: ["Workflows"],
        summary: "List workflows in workspace with pagination and filters",
        description: "Retrieves workflows with run counters, last run execution summaries, and associated dataset links.",
        operationId: "listWorkflows",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "workspaceId", in: "query", schema: { type: "string", format: "uuid" }, description: "Filter by workspace UUID" },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
          { name: "status", in: "query", schema: { type: "string", enum: ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "FAILED"] } },
          { name: "search", in: "query", schema: { type: "string" }, description: "Search by workflow name or prompt" },
        ],
        responses: {
          "200": {
            description: "Paginated list of workflows",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WorkflowListResponse" } } },
          },
        },
      },
    },
    "/workflows/{id}": {
      get: {
        tags: ["Workflows"],
        summary: "Get workflow detail with active plan definition",
        description: "Returns workflow metadata, execution history counters, and the complete versioned step graph.",
        operationId: "getWorkflow",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Workflow detail with plan",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WorkflowDetailResponse" } } },
          },
          "404": { description: "Workflow not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/workflows/{id}/runs": {
      get: {
        tags: ["Workflows"],
        summary: "List execution runs for a specific workflow",
        description: "Returns paginated runs for the specified workflow, including durations, record counts, and status.",
        operationId: "listWorkflowRuns",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "status", in: "query", schema: { type: "string", enum: ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] } },
        ],
        responses: {
          "200": {
            description: "Paginated workflow runs",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WorkflowRunListResponse" } } },
          },
        },
      },
    },

    // =========================================================================
    // 4. RUNS & EVENTS ENDPOINTS (Screen 3: Live Running & Screen 8: Activity)
    // =========================================================================
    "/runs/{id}": {
      get: {
        tags: ["Runs"],
        summary: "Get execution status and step metrics of a workflow run",
        description: "Returns live metrics (records found, accepted, duplicates, sources), status, timing, and step execution details.",
        operationId: "getRun",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Workflow run view",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WorkflowRunView" } } },
          },
          "404": { description: "Run not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/runs/{id}/steps": {
      get: {
        tags: ["Runs"],
        summary: "Get ordered step executions for a run",
        description: "Returns detailed execution status for each step in the workflow graph, including attempt counts, duration, and output summaries.",
        operationId: "getRunSteps",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "List of step executions",
            content: { "application/json": { schema: { $ref: "#/components/schemas/RunStepsResponse" } } },
          },
        },
      },
    },
    "/runs/{id}/cancel": {
      post: {
        tags: ["Runs"],
        summary: "Request cancellation of an active workflow run",
        description: "Marks cancellation state durably in MySQL; worker halts further step dispatch at the next execution boundary.",
        operationId: "cancelRun",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Cancellation requested",
            content: { "application/json": { schema: { $ref: "#/components/schemas/CancelRunResponse" } } },
          },
          "404": { description: "Run not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/runs/{id}/activity": {
      get: {
        tags: ["Activity"],
        summary: "Get persistent audit log of activity events for a run",
        description: "Retrieves complete chronological list of activity events durably recorded in MySQL for the run.",
        operationId: "getRunActivity",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "List of activity events",
            content: { "application/json": { schema: { $ref: "#/components/schemas/RunActivityResponse" } } },
          },
        },
      },
    },
    "/runs/{id}/events": {
      get: {
        tags: ["Events"],
        summary: "Stream real-time execution events via Server-Sent Events (SSE)",
        description: "Connect via browser `EventSource` (`Accept: text/event-stream`). Replays historical activity on connection, receives live events across worker nodes via Redis Pub/Sub, and streams 15s keepalive heartbeats. Accepts `Last-Event-ID` header for reconnection.",
        operationId: "streamRunEvents",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "token", in: "query", schema: { type: "string" }, description: "Optional query-param token for standard browser EventSource API" },
          { name: "Last-Event-ID", in: "header", schema: { type: "string" }, description: "Resume stream from last received event ID" },
        ],
        responses: {
          "200": {
            description: "SSE Event Stream",
            content: {
              "text/event-stream": {
                schema: {
                  type: "string",
                  example: "id: 71cb294a-9b1d-4054-9549-33d7b889d1b5\nevent: message\ndata: {\"id\":\"71cb...\",\"action\":\"EXTRACTION_STARTED\",\"description\":\"Extracting entities\"}\n\n",
                },
              },
            },
          },
          "401": { description: "Unauthenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "403": { description: "Workspace access denied", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "404": { description: "Run not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },

    // =========================================================================
    // 5. DATASETS & ROWS ENDPOINTS (Screen 5: Dataset Explorer)
    // =========================================================================
    "/datasets": {
      get: {
        tags: ["Datasets"],
        summary: "List datasets in workspace with pagination and sorting",
        description: "Retrieves business datasets with record counts, valid counts, duplicate counts, and schema summary.",
        operationId: "listDatasets",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "workspaceId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "search", in: "query", schema: { type: "string" }, description: "Search by dataset name or original prompt" },
          { name: "sortBy", in: "query", schema: { type: "string", enum: ["name", "createdAt", "recordCount"], default: "createdAt" } },
          { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
        ],
        responses: {
          "200": {
            description: "Paginated dataset summaries",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DatasetListResponse" } } },
          },
        },
      },
    },
    "/datasets/{id}": {
      get: {
        tags: ["Datasets"],
        summary: "Get dataset detail and column specifications",
        description: "Returns dataset metadata, record totals, source count, and dynamic column definitions.",
        operationId: "getDataset",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Dataset detail view",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DatasetSummaryItem" } } },
          },
          "404": { description: "Dataset not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/datasets/{id}/schema": {
      get: {
        tags: ["Datasets"],
        summary: "Get dynamic column schemas for a dataset",
        description: "Returns typed column specifications (key, name, type, required, orderIndex) for rendering sticky table headers and filter dropdowns.",
        operationId: "getDatasetSchema",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Dataset column schemas",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DatasetSchemaResponse" } } },
          },
        },
      },
    },
    "/datasets/{id}/rows": {
      get: {
        tags: ["Rows"],
        summary: "Query dataset rows with dynamic filtering, full-text search, and pagination",
        description: "Primary table endpoint. Coexists dynamic JSON fields with relational columns. Supports free-text search across all values, validOnly/duplicatesOnly filters, verification status, confidence score thresholding, source ID filtering, field-specific filters, and dynamic column sorting.",
        operationId: "queryDatasetRows",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
          { name: "search", in: "query", schema: { type: "string" }, description: "Full-text search query across all row fields" },
          { name: "validOnly", in: "query", schema: { type: "boolean" }, description: "Only return valid rows" },
          { name: "duplicatesOnly", in: "query", schema: { type: "boolean" }, description: "Only return duplicate records" },
          { name: "verificationStatus", in: "query", schema: { type: "string", enum: ["VERIFIED", "SOURCE_CITED_UNVERIFIED", "UNSUPPORTED", "CONFLICTED"] } },
          { name: "minConfidence", in: "query", schema: { type: "number", minimum: 0, maximum: 1 } },
          { name: "sourceId", in: "query", schema: { type: "string", format: "uuid" }, description: "Filter rows linked to a specific source" },
          { name: "fieldFilters", in: "query", schema: { type: "string" }, description: "JSON stringified map of field key to substring match, e.g. `{\"company_name\":\"Alpha\"}`" },
          { name: "sortBy", in: "query", schema: { type: "string" }, description: "Column key (e.g. `company_name`) or meta field (`rowNumber`, `confidenceScore`, `createdAt`)" },
          { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "asc" } },
        ],
        responses: {
          "200": {
            description: "Paginated list of dataset rows",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DatasetRowsListResponse" } } },
          },
        },
      },
    },
    "/datasets/{id}/rows/{rowId}": {
      get: {
        tags: ["Rows"],
        summary: "Get single dataset row by ID",
        description: "Returns individual row with extracted values, raw values, verification status, and linked source citations.",
        operationId: "getDatasetRow",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "rowId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Single row view",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DatasetRowItem" } } },
          },
          "404": { description: "Row not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },

    // =========================================================================
    // 6. SOURCES & EVIDENCE ENDPOINTS (Screen 6: Source & Evidence Explorer)
    // =========================================================================
    "/datasets/{id}/sources": {
      get: {
        tags: ["Sources"],
        summary: "List all web sources contributing to a dataset",
        description: "Returns distinct sources fetched in the dataset's workflow run with domains, HTTP statuses, and contribution counts.",
        operationId: "listDatasetSources",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["COLLECTED", "FETCHED", "BLOCKED", "FAILED"] } },
        ],
        responses: {
          "200": {
            description: "Paginated dataset sources",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DatasetSourcesListResponse" } } },
          },
        },
      },
    },
    "/sources/{id}": {
      get: {
        tags: ["Sources"],
        summary: "Get source detail, governance checks, and extracted snippets",
        description: "Returns complete source provenance, policy/robots compliance check reasons, request attempt count, retrieval timestamp, and raw snippets.",
        operationId: "getSource",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Source detail view",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SourceDetailView" } } },
          },
          "404": { description: "Source not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/rows/{id}/evidence": {
      get: {
        tags: ["Evidence"],
        summary: "Get field-level evidence and provenance explorer for a row",
        description: "Powers the Source Drawer / Modal. Answers 'Where did this data come from?' at granular field level. Shows supporting sources per field, verification check (`isVerified: true/false`), confidence scores, extracted snippet citations, and source conflict disagreements.",
        operationId: "getRowEvidence",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Field-level evidence and provenance details",
            content: { "application/json": { schema: { $ref: "#/components/schemas/RowEvidenceExplorerResponse" } } },
          },
          "404": { description: "Row not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/datasets/{id}/rows/{rowId}/evidence": {
      get: {
        tags: ["Evidence"],
        summary: "Get field-level evidence for a row (Dataset-scoped alias)",
        description: "Convenience alias for `/rows/{id}/evidence` operating within dataset hierarchy context.",
        operationId: "getDatasetRowEvidence",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "rowId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Field-level evidence and provenance details",
            content: { "application/json": { schema: { $ref: "#/components/schemas/RowEvidenceExplorerResponse" } } },
          },
        },
      },
    },

    // =========================================================================
    // 7. EXPORTS ENDPOINTS (Screen 7: Export)
    // =========================================================================
    "/datasets/{id}/exports": {
      post: {
        tags: ["Exports"],
        summary: "Create asynchronous dataset export job",
        description: "Initiates asynchronous background export job. Supports CSV (RFC 4180 escaped), JSON (streaming array), and XLSX (ExcelJS streaming). Allows exporting all or selected column subsets, with optional filters applied.",
        operationId: "createExportJob",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateExportRequest" } } },
        },
        responses: {
          "202": {
            description: "Export job accepted and started in background",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ExportJobView" } } },
          },
          "400": { description: "Unsupported format or invalid column keys", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "404": { description: "Dataset not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/exports/{id}": {
      get: {
        tags: ["Exports"],
        summary: "Poll status and file metadata of an export job",
        description: "Returns export job status (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`), generation timestamps, row/column counts, byte size, and SHA256 checksum.",
        operationId: "getExportStatus",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Export job view with metadata",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ExportJobView" } } },
          },
          "404": { description: "Export job not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/exports/{id}/download": {
      get: {
        tags: ["Exports"],
        summary: "Download generated export file",
        description: "Streams the completed file binary to client with appropriate `Content-Type` and `Content-Disposition: attachment; filename=...`. Returns 400 if export is still in progress.",
        operationId: "downloadExport",
        security: [{ BearerAuth: [] }, { WorkspaceHeader: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "token", in: "query", schema: { type: "string" }, description: "Optional query-param token for direct browser anchor link downloads" },
        ],
        responses: {
          "200": {
            description: "File stream (text/csv, application/json, or application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)",
            headers: {
              "Content-Disposition": { schema: { type: "string", example: "attachment; filename=\"dataset-berlin-ai.csv\"" } },
              "Content-Type": { schema: { type: "string", example: "text/csv" } },
              "Content-Length": { schema: { type: "integer", example: 12480 } },
            },
            content: {
              "text/csv": { schema: { type: "string", format: "binary" } },
              "application/json": { schema: { type: "string", format: "binary" } },
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } },
            },
          },
          "400": { description: "Export job not completed yet (EXPORT_NOT_READY)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "404": { description: "Export file or job not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },

    // =========================================================================
    // 8. HEALTH & OPENAPI SPECIFICATION
    // =========================================================================
    "/openapi.json": {
      get: {
        tags: ["Health"],
        summary: "Retrieve OpenAPI 3.1.0 specification document",
        description: "Serves the full machine-readable OpenAPI specification in JSON format for client generation and interactive documentation.",
        operationId: "getOpenApiSpec",
        responses: {
          "200": {
            description: "OpenAPI 3.1.0 Specification document",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
  },
};
