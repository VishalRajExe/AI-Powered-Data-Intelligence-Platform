import { z } from "zod";

const emptyToUndefined = (value: unknown): unknown => value === "" ? undefined : value;
const optionalSecret = z.preprocess(emptyToUndefined, z.string().min(32).optional());

const environmentSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173")
    .superRefine((value, context) => {
      const url = new URL(value);
      if (url.pathname !== "/" || url.search || url.hash) {
        context.addIssue({ code: "custom", message: "Must be an origin without a path, query, or fragment" });
      }
    })
    .transform((value) => new URL(value).origin),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  REQUEST_BODY_LIMIT: z.string().regex(/^\d+(?:b|kb|mb|gb)$/i).default("1mb"),
  SOURCE_ROBOTS_USER_AGENT: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).default("ScoutlyBot"),
  SOURCE_ROBOTS_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(5_000),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  MYSQL_HOST: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  MYSQL_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65_535).optional()),
  MYSQL_USER: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  MYSQL_PASSWORD: z.string().default(""),
  MYSQL_DATABASE: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379").refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "redis:" || protocol === "rediss:";
  }, "Must use redis:// or rediss://"),
  FIRECRAWL_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  FIRECRAWL_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  LLM_PROVIDER: z.enum(["google", "anthropic", "openai", "gateway", "custom-openai"]).default("google"),
  LLM_MODEL_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GOOGLE_GENERATIVE_AI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AI_GATEWAY_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  CUSTOM_OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  CUSTOM_OPENAI_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  JWT_ACCESS_SECRET: optionalSecret,
  JWT_REFRESH_SECRET: optionalSecret,
}).superRefine((env, context) => {
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      if (url.protocol !== "mysql:") throw new Error("protocol");
    } catch {
      context.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "Must be a valid MySQL connection URL" });
    }
  } else {
    const components = [env.MYSQL_HOST, env.MYSQL_PORT, env.MYSQL_USER, env.MYSQL_PASSWORD, env.MYSQL_DATABASE];
    if (components.some((part) => part === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "Set DATABASE_URL or all MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE values",
      });
    }
  }

  const hasAccessSecret = env.JWT_ACCESS_SECRET !== undefined;
  const hasRefreshSecret = env.JWT_REFRESH_SECRET !== undefined;
  if (hasAccessSecret !== hasRefreshSecret) {
    context.addIssue({ code: "custom", path: ["JWT_ACCESS_SECRET"], message: "Configure both JWT secrets together or leave both empty" });
  }
  if (env.LLM_PROVIDER === "custom-openai" && !env.CUSTOM_OPENAI_BASE_URL) {
    context.addIssue({ code: "custom", path: ["CUSTOM_OPENAI_BASE_URL"], message: "Required when LLM_PROVIDER is custom-openai" });
  }
});

export type AppConfig = Omit<z.infer<typeof environmentSchema>, "DATABASE_URL"> & { DATABASE_URL: string };

export class EnvironmentConfigError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super(`Invalid environment configuration: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    this.name = "EnvironmentConfigError";
  }
}

export function loadEnvConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvironmentConfigError(parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })));
  }

  const env = parsed.data;
  const databaseUrl = env.DATABASE_URL ?? buildMysqlUrl({
    host: env.MYSQL_HOST!,
    port: env.MYSQL_PORT!,
    user: env.MYSQL_USER!,
    password: env.MYSQL_PASSWORD!,
    database: env.MYSQL_DATABASE!,
  });

  return { ...env, DATABASE_URL: databaseUrl };
}

function buildMysqlUrl(parts: { host: string; port: number; user: string; password: string; database: string }): string {
  const user = encodeURIComponent(parts.user);
  const password = encodeURIComponent(parts.password);
  const database = encodeURIComponent(parts.database);
  return `mysql://${user}:${password}@${parts.host}:${parts.port}/${database}`;
}

export function assertAgentCredentials(config: AppConfig): void {
  if (!config.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is required to execute a collection run");
  assertLlmCredentials(config);
}

export function assertLlmCredentials(config: AppConfig): void {
  const providerKey = {
    google: config.GOOGLE_GENERATIVE_AI_API_KEY,
    anthropic: config.ANTHROPIC_API_KEY,
    openai: config.OPENAI_API_KEY,
    gateway: config.AI_GATEWAY_API_KEY,
    "custom-openai": config.CUSTOM_OPENAI_API_KEY,
  }[config.LLM_PROVIDER];
  if (!providerKey) throw new Error(`Credentials for LLM_PROVIDER=${config.LLM_PROVIDER} are not configured`);
  if (!config.LLM_MODEL_ID) throw new Error("LLM_MODEL_ID must be configured to parse a requirement");
}
