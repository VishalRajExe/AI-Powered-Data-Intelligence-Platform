import pino, { type Logger } from "pino";

export function createLogger(level: string, environment: string): Logger {
  return pino({
    level,
    base: { service: "aidp-backend", environment },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.password",
        "*.token",
        "*.apiKey",
        "*.secret",
        "FIRECRAWL_API_KEY",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "DATABASE_URL",
      ],
      censor: "[REDACTED]",
    },
    ...(environment === "development" ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}
