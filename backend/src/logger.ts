import pino, { type Logger } from "pino";

export function createLogger(level: string, environment: string): Logger {
  return pino({
    level,
    base: { service: "aidp-backend", environment },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-api-key']",
        "req.body.password",
        "req.body.token",
        "req.body.refreshToken",
        "*.password",
        "*.token",
        "*.accessToken",
        "*.refreshToken",
        "*.apiKey",
        "*.secret",
        "*.passHash",
        "*.passwordHash",
        "FIRECRAWL_API_KEY",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "AI_GATEWAY_API_KEY",
        "CUSTOM_OPENAI_API_KEY",
        "JWT_ACCESS_SECRET",
        "JWT_REFRESH_SECRET",
        "DATABASE_URL",
        "REDIS_URL",
        "MYSQL_PASSWORD",
      ],
      censor: "[REDACTED]",
    },
    ...(environment === "development" ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}
