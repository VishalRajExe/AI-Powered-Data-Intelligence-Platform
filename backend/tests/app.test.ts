import pino from "pino";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnvConfig, EnvironmentConfigError, assertAgentCredentials } from "../src/config/env.js";
import { createErrorHandler } from "../src/common/errors.js";
import { validateRequest } from "../src/common/validateRequest.js";
import { z } from "zod";

function makeConfig(overrides: Record<string, string> = {}) {
  return loadEnvConfig({
    APP_ENV: "test",
    MYSQL_HOST: "localhost",
    MYSQL_PORT: "3306",
    MYSQL_USER: "aidp",
    MYSQL_PASSWORD: "",
    MYSQL_DATABASE: "aidp_test",
    ...overrides,
  });
}

function makeApp(mysql: () => Promise<unknown> = async () => 1, redis: () => Promise<unknown> = async () => "PONG") {
  return createApp({
    config: makeConfig(),
    logger: pino({ enabled: false }),
    requirementParser: { parse: async () => { throw new Error("Requirement parser not used in this test"); } },
    workflowPlanner: { plan: async () => { throw new Error("Workflow planner not used in this test"); } },
    workflowExecution: { execute: async () => { throw new Error("Workflow execution not used in this test"); } },
    agentAdapter: { checkConfiguration: () => ({ configured: false, provider: "google", model: null, missing: ["FIRECRAWL_API_KEY"] }), execute: async () => { throw new Error("Agent not used in this test"); } },
    readiness: { mysql, redis },
  });
}

describe("foundation API", () => {
  it("reports process health without checking dependencies", async () => {
    const app = makeApp(() => Promise.reject(new Error("db down")));
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("reports ready only when MySQL and Redis are reachable", async () => {
    const app = makeApp(() => Promise.reject(new Error("db down")));
    const response = await request(app).get("/ready");
    expect(response.status).toBe(503);
    expect(response.body.dependencies).toEqual({ mysql: "unavailable", redis: "ok" });
  });

  it("reports Firecrawl configuration separately from core service readiness", async () => {
    const app = makeApp();
    const response = await request(app).get("/health/firecrawl");
    expect(response.status).toBe(503);
    expect(response.body.status).toBe("not_configured");
    expect(response.body.missing).toContain("FIRECRAWL_API_KEY");
    expect(response.text).not.toContain("test-key");
  });

  it("returns request IDs and does not expose exception details", async () => {
    const logger = pino({ enabled: false });
    const app = express();
    app.get("/fail", (_request, _response, next) => next(new Error("database password leaked")));
    app.use(createErrorHandler(logger));
    const response = await request(app).get("/fail");
    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe("An unexpected error occurred");
    expect(response.text).not.toContain("database password leaked");
  });

  it("validates request data before route handling", async () => {
    const app = express();
    app.use(express.json());
    app.post("/items", validateRequest({ body: z.object({ name: z.string().min(1) }) }), (_request, response) => {
      response.json({ accepted: true });
    });
    app.use(createErrorHandler(pino({ enabled: false })));
    const bad = await request(app).post("/items").send({ name: "" });
    const good = await request(app).post("/items").send({ name: "row" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    expect(good.status).toBe(200);
  });

  it("limits CORS access to the configured frontend origin", async () => {
    const app = makeApp();
    const allowed = await request(app).get("/health").set("Origin", "http://localhost:5173");
    const denied = await request(app).get("/health").set("Origin", "https://untrusted.example");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("environment configuration", () => {
  it("builds a MySQL URL from components and encodes credentials", () => {
    const config = makeConfig({ MYSQL_PASSWORD: "p@ss:/word" });
    expect(config.DATABASE_URL).toBe("mysql://aidp:p%40ss%3A%2Fword@localhost:3306/aidp_test");
  });

  it("rejects incomplete MySQL config and one-sided JWT setup", () => {
    expect(() => loadEnvConfig({ APP_ENV: "test" })).toThrow(EnvironmentConfigError);
    expect(() => makeConfig({ JWT_ACCESS_SECRET: "x".repeat(40) })).toThrow(/both JWT secrets/);
  });

  it("rejects malformed body limits, Redis schemes, and non-origin frontend URLs", () => {
    expect(() => makeConfig({ REQUEST_BODY_LIMIT: "unlimited" })).toThrow(EnvironmentConfigError);
    expect(() => makeConfig({ REDIS_URL: "https://redis.example" })).toThrow(EnvironmentConfigError);
    expect(() => makeConfig({ FRONTEND_ORIGIN: "https://app.example/path" })).toThrow(EnvironmentConfigError);
  });

  it("requires Firecrawl and the selected model-provider key only when collection is requested", () => {
    const config = makeConfig();
    expect(() => assertAgentCredentials(config)).toThrow(/FIRECRAWL_API_KEY/);
    expect(() => assertAgentCredentials(makeConfig({ FIRECRAWL_API_KEY: "fc-test" }))).toThrow(/LLM_PROVIDER=google/);
    expect(() => assertAgentCredentials(makeConfig({ FIRECRAWL_API_KEY: "fc-test", GOOGLE_GENERATIVE_AI_API_KEY: "key", LLM_MODEL_ID: "gemini-test" }))).not.toThrow();
  });
});
