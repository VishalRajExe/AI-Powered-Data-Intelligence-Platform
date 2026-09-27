import { PrismaClient } from "@prisma/client";

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({ log: process.env.APP_ENV === "development" ? ["warn", "error"] : ["error"] });
}
