/**
 * Typed response envelopes for the only endpoints Phase 1 consumes:
 * backend health (`GET /api/v1/health`) and readiness (`GET /api/v1/ready`).
 *
 * Fields are optional wherever the backend may legitimately omit part of a report:
 * the UI renders a missing field as "unavailable" instead of substituting a value.
 */

export type ComponentStatus = "UP" | "DOWN";

/** `GET /api/v1/health` — liveness. */
export interface HealthResponse {
  status: string;
  application: string;
  profile: string;
  /** Present on the live Phase 1 backend; absent from the documented envelope, so optional. */
  version?: string;
  timestamp: string;
}

/** One dependency entry inside the readiness report. */
export interface ReadinessComponent {
  status: ComponentStatus;
  /** Backend-supplied free-form detail (e.g. `{ database: "finalagent_dev" }`). Never synthesized. */
  details?: Record<string, string | number | boolean | null>;
}

/** The dependency map inside the readiness report. */
export interface ReadinessComponents {
  mysql?: ReadinessComponent;
  aiService?: ReadinessComponent;
  credentials?: ReadinessComponent;
}

/**
 * `GET /api/v1/ready` — HTTP 200 when every check passes, 503 otherwise.
 * Both codes carry this same envelope, so the UI must read `status`/`components`, not the code.
 */
export interface ReadinessResponse {
  status: ComponentStatus;
  components?: ReadinessComponents;
  timestamp: string;
}

/** Spring Boot error envelope: `{ error, message, ... }`. */
export interface ErrorEnvelope {
  error?: string;
  message?: string;
  [key: string]: unknown;
}
