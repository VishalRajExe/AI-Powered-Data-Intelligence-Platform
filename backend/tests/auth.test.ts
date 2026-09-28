import express from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { createApp } from "../src/app.js";
import { loadEnvConfig } from "../src/config/env.js";
import { MockAgentAdapter } from "../src/agent/MockAgentAdapter.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { requireWorkspaceAccess } from "../src/modules/auth/auth.middleware.js";
import type { PrismaClient, User, Workspace, WorkspaceMember, UserStatus, WorkspaceStatus, WorkspaceRole, MembershipStatus } from "@prisma/client";
import type { RequirementParser } from "../src/modules/requirements/parser.service.js";
import type { WorkflowPlanner } from "../src/modules/planner/planner.service.js";
import type { WorkflowExecutionServiceContract } from "../src/modules/workflows/workflow-execution.service.js";

const ACCESS_SECRET = "test_access_secret_with_32_characters_minimum!";
const REFRESH_SECRET = "test_refresh_secret_with_32_characters_minimum!";

function createMockPrisma() {
  const users = new Map<string, User>();
  const workspaces = new Map<string, Workspace>();
  const members = new Map<string, WorkspaceMember>();

  const mock = {
    user: {
      findUnique: async (args: { where: { email?: string; id?: string }; include?: { memberships?: { where?: Record<string, unknown>; include?: { workspace?: boolean } } } }) => {
        let u: User | undefined;
        if (args.where.email) {
          for (const item of users.values()) {
            if (item.email.toLowerCase() === args.where.email.toLowerCase()) {
              u = item;
              break;
            }
          }
        } else if (args.where.id) {
          u = users.get(args.where.id);
        }

        if (!u) return null;

        if (args.include?.memberships) {
          const userMembers: Array<WorkspaceMember & { workspace: Workspace }> = [];
          for (const m of members.values()) {
            if (m.userId === u.id && m.status === "ACTIVE") {
              const ws = workspaces.get(m.workspaceId);
              if (ws) {
                userMembers.push({ ...m, workspace: ws });
              }
            }
          }
          return { ...u, memberships: userMembers };
        }

        return u;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const id = (args.data.id as string) || crypto.randomUUID();
        const user: User = {
          id,
          email: String(args.data.email),
          passwordHash: String(args.data.passwordHash),
          name: (args.data.name as string) || null,
          status: (args.data.status as UserStatus) || "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        users.set(id, user);
        return user;
      },
    },
    workspace: {
      create: async (args: { data: Record<string, unknown> }) => {
        const id = (args.data.id as string) || crypto.randomUUID();
        const ws: Workspace = {
          id,
          name: String(args.data.name),
          slug: String(args.data.slug),
          createdById: String(args.data.createdById),
          status: (args.data.status as WorkspaceStatus) || "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        workspaces.set(id, ws);
        return ws;
      },
      findUnique: async (args: { where: { id?: string; slug?: string } }) => {
        if (args.where.id) return workspaces.get(args.where.id) ?? null;
        return null;
      },
    },
    workspaceMember: {
      create: async (args: { data: Record<string, unknown> }) => {
        const member: WorkspaceMember = {
          workspaceId: String(args.data.workspaceId),
          userId: String(args.data.userId),
          role: (args.data.role as WorkspaceRole) || "MEMBER",
          status: (args.data.status as MembershipStatus) || "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const key = `${member.workspaceId}_${member.userId}`;
        members.set(key, member);
        return member;
      },
      findUnique: async (args: { where: { workspaceId_userId: { workspaceId: string; userId: string } }; include?: { workspace?: boolean } }) => {
        const key = `${args.where.workspaceId_userId.workspaceId}_${args.where.workspaceId_userId.userId}`;
        const m = members.get(key);
        if (!m) return null;
        if (args.include?.workspace) {
          const ws = workspaces.get(m.workspaceId);
          if (!ws) return null;
          return { ...m, workspace: ws };
        }
        return m;
      },
    },
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
      return callback(mock);
    },
  };

  return { prisma: mock as unknown as PrismaClient, users, workspaces, members };
}

function createTestContext() {
  const { prisma, users, workspaces, members } = createMockPrisma();
  const tokenService = new TokenService({
    accessSecret: ACCESS_SECRET,
    refreshSecret: REFRESH_SECRET,
    accessTokenTtlSec: 60, // 1 minute
    refreshTokenTtlSec: 3600, // 1 hour
  });
  const authService = new AuthService(prisma, tokenService);

  const config = loadEnvConfig({
    APP_ENV: "test",
    MYSQL_HOST: "localhost",
    MYSQL_PORT: "3306",
    MYSQL_USER: "aidp",
    MYSQL_PASSWORD: "",
    MYSQL_DATABASE: "aidp_test",
    JWT_ACCESS_SECRET: ACCESS_SECRET,
    JWT_REFRESH_SECRET: REFRESH_SECRET,
  });

  const logger = pino({ level: "silent" });

  const testRouter = express.Router();
  testRouter.get(
    "/workspaces/:workspaceId/test-resource",
    requireWorkspaceAccess(prisma),
    (_req, res) => {
      res.json({ message: "Access granted", workspaceId: res.locals.workspaceId });
    },
  );

  const app = createApp({
    config,
    logger,
    readiness: { mysql: async () => {}, redis: async () => {} },
    requirementParser: {} as unknown as RequirementParser,
    workflowPlanner: {} as unknown as WorkflowPlanner,
    workflowExecution: {} as unknown as WorkflowExecutionServiceContract,
    agentAdapter: new MockAgentAdapter(),
    authService,
    tokenService,
    customRoutes: [{ path: "/api/v1", router: testRouter }],
  });

  return { app, authService, tokenService, prisma, users, workspaces, members };
}

describe("Phase 13 — Authentication and Authorization", () => {
  describe("1. Registration & Login Flow", () => {
    it("registers a new user, creates default workspace with OWNER role, and never returns password hashes", async () => {
      const { app } = createTestContext();

      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "alice@example.com",
          password: "SuperSecretPassword123!",
          name: "Alice Doe",
          workspaceName: "Alice AI Lab",
        });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe("alice@example.com");
      expect(res.body.user.name).toBe("Alice Doe");
      expect(res.body.user.status).toBe("ACTIVE");

      // Critical requirement: NEVER return password hashes
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("passwordHash");
      expect(JSON.stringify(res.body)).not.toContain("$2a$");

      // Check workspace created with OWNER role
      expect(res.body.workspaces).toHaveLength(1);
      expect(res.body.workspaces[0].name).toBe("Alice AI Lab");
      expect(res.body.workspaces[0].role).toBe("OWNER");
      expect(res.body.workspaces[0].status).toBe("ACTIVE");

      // Check tokens
      expect(res.body.tokens.accessToken).toBeDefined();
      expect(res.body.tokens.refreshToken).toBeDefined();
      expect(res.body.tokens.tokenType).toBe("Bearer");
    });

    it("rejects duplicate email registration with 409 EMAIL_ALREADY_EXISTS", async () => {
      const { app } = createTestContext();

      await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "duplicate@example.com",
          password: "Password123!",
        });

      const duplicateRes = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "duplicate@example.com",
          password: "DifferentPassword456!",
        });

      expect(duplicateRes.status).toBe(409);
      expect(duplicateRes.body.error.code).toBe("EMAIL_ALREADY_EXISTS");
    });

    it("logs in with valid credentials and returns tokens without password hashes", async () => {
      const { app } = createTestContext();

      // Register first
      await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "bob@example.com",
          password: "Password123!",
          name: "Bob",
        });

      // Login
      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: "bob@example.com",
          password: "Password123!",
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.email).toBe("bob@example.com");
      expect(loginRes.body.user.passwordHash).toBeUndefined();
      expect(loginRes.body.tokens.accessToken).toBeDefined();
      expect(loginRes.body.workspaces).toHaveLength(1);
    });

    it("rejects login with wrong password (401 INVALID_CREDENTIALS)", async () => {
      const { app } = createTestContext();

      await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "carol@example.com",
          password: "CorrectPassword123!",
        });

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: "carol@example.com",
          password: "WrongPassword!",
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });
  });

  describe("2. Token Refresh & Logout Flow", () => {
    it("refreshes access token with valid refresh token", async () => {
      const { app } = createTestContext();

      const regRes = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "refresh@example.com",
          password: "Password123!",
        });

      const refreshToken = regRes.body.tokens.refreshToken;

      const refreshRes = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.accessToken).toBeDefined();
      expect(refreshRes.body.tokenType).toBe("Bearer");
    });

    it("logout revokes the refresh token so subsequent refresh fails", async () => {
      const { app } = createTestContext();

      const regRes = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "logout@example.com",
          password: "Password123!",
        });

      const refreshToken = regRes.body.tokens.refreshToken;

      // Logout
      const logoutRes = await request(app)
        .post("/api/v1/auth/logout")
        .send({ refreshToken });

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.message).toContain("Logged out");

      // Attempt to refresh with the revoked token
      const failedRefresh = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken });

      expect(failedRefresh.status).toBe(401);
      expect(failedRefresh.body.error.code).toBe("TOKEN_REVOKED");
    });
  });

  describe("3. Authentication Tests (Required: unauthenticated, authenticated, expired token, invalid token)", () => {
    it("unauthenticated: accessing /api/v1/auth/me without token returns 401 UNAUTHENTICATED", async () => {
      const { app } = createTestContext();

      const res = await request(app).get("/api/v1/auth/me");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("authenticated: accessing /api/v1/auth/me with valid Bearer token returns current user and workspaces", async () => {
      const { app } = createTestContext();

      const reg = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "me@example.com",
          password: "Password123!",
          name: "Me User",
        });

      const accessToken = reg.body.tokens.accessToken;

      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe("me@example.com");
      expect(res.body.user.name).toBe("Me User");
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(res.body.workspaces).toHaveLength(1);
    });

    it("expired token: returns 401 TOKEN_EXPIRED when token has expired", async () => {
      const { app } = createTestContext();

      // Sign an already expired token (-10 seconds)
      const expiredToken = jwt.sign(
        { sub: "user-123", email: "expired@example.com", type: "access" },
        ACCESS_SECRET,
        { expiresIn: -10 },
      );

      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("TOKEN_EXPIRED");
    });

    it("invalid token: returns 401 INVALID_TOKEN when signature is tampered or invalid", async () => {
      const { app } = createTestContext();

      // Sign with a different secret
      const forgedToken = jwt.sign(
        { sub: "user-hacker", email: "hacker@example.com", type: "access" },
        "wrong_secret_key_used_by_attacker_32_chars!",
      );

      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${forgedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_TOKEN");
    });
  });

  describe("4. Authorization Tests (Required: wrong user, workspace isolation)", () => {
    it("wrong user: rejects client-supplied userId that does not match authenticated user (403 FORBIDDEN_USER_MISMATCH)", async () => {
      const { app } = createTestContext();

      const regUserA = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "userA@example.com",
          password: "Password123!",
        });

      const tokenA = regUserA.body.tokens.accessToken;
      const fakeUserBId = crypto.randomUUID();

      // Attempt to send a request claiming to be fakeUserBId in query
      const res = await request(app)
        .get(`/api/v1/auth/me?userId=${fakeUserBId}`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN_USER_MISMATCH");
    });

    it("workspace isolation: User A cannot access Workspace B where they are not a member (403 WORKSPACE_ACCESS_DENIED)", async () => {
      const { app } = createTestContext();

      // User A registers
      const regUserA = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "userA-isolation@example.com",
          password: "Password123!",
          workspaceName: "Workspace A",
        });

      // User B registers
      const regUserB = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "userB-isolation@example.com",
          password: "Password123!",
          workspaceName: "Workspace B",
        });

      const tokenA = regUserA.body.tokens.accessToken;
      const workspaceBId = regUserB.body.workspaces[0].id;

      // User A attempts to access Workspace B
      const unauthorizedAccess = await request(app)
        .get(`/api/v1/workspaces/${workspaceBId}/test-resource`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(unauthorizedAccess.status).toBe(403);
      expect(unauthorizedAccess.body.error.code).toBe("WORKSPACE_ACCESS_DENIED");
    });

    it("workspace isolation: User B can access their own Workspace B (200 OK)", async () => {
      const { app } = createTestContext();

      const regUserB = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "ownerB@example.com",
          password: "Password123!",
          workspaceName: "Workspace B",
        });

      const tokenB = regUserB.body.tokens.accessToken;
      const workspaceBId = regUserB.body.workspaces[0].id;

      const authorizedAccess = await request(app)
        .get(`/api/v1/workspaces/${workspaceBId}/test-resource`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(authorizedAccess.status).toBe(200);
      expect(authorizedAccess.body.workspaceId).toBe(workspaceBId);
    });
  });
});
