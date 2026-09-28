import { Router } from "express";
import type { AgentConfigurationHealth } from "../agent/types.js";

export interface ReadinessProbes {
  mysql: () => Promise<unknown>;
  redis: () => Promise<unknown>;
}

export function createHealthRouter(probes: ReadinessProbes, checkAgent: () => AgentConfigurationHealth): Router {
  const router = Router();

  router.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "api", timestamp: new Date().toISOString() });
  });

  router.get("/health/firecrawl", (_request, response) => {
    const configuration = checkAgent();
    response.status(configuration.configured ? 200 : 503).json({
      status: configuration.configured ? "configured" : "not_configured",
      provider: configuration.provider,
      model: configuration.model,
      missing: configuration.missing,
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/ready", async (_request, response) => {
    const checks = await Promise.allSettled([
      withTimeout(probes.mysql(), 2_000),
      withTimeout(probes.redis(), 2_000),
    ]);
    const dependencies = {
      mysql: checks[0]?.status === "fulfilled" ? "ok" : "unavailable",
      redis: checks[1]?.status === "fulfilled" ? "ok" : "unavailable",
    };
    const ready = Object.values(dependencies).every((status) => status === "ok");

    response.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      dependencies,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Dependency check timed out")), timeoutMs);
    timeout.unref();
    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}
