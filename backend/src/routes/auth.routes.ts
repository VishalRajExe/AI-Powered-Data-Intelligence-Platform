import { Router } from "express";
import { z } from "zod";
import { validateRequest } from "../common/validateRequest.js";
import type { AuthService } from "../modules/auth/auth.service.js";
import { authenticate } from "../modules/auth/auth.middleware.js";
import type { TokenService } from "../modules/auth/token.service.js";

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const RegisterBody = z.object({
  email: z.string().trim().email("Must be a valid email address").max(254),
  password: z.string().min(8, "Password must be at least 8 characters long").max(128),
  name: z.string().trim().max(160).optional(),
  workspaceName: z.string().trim().max(160).optional(),
});

const LoginBody = z.object({
  email: z.string().trim().email("Must be a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const RefreshBody = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

const LogoutBody = z.object({
  refreshToken: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Router Factory
// ---------------------------------------------------------------------------

export function createAuthRouter(
  authService: AuthService,
  tokenService: TokenService,
): Router {
  const router = Router();

  // POST /api/v1/auth/register
  router.post(
    "/auth/register",
    validateRequest({ body: RegisterBody }),
    async (_req, res) => {
      const { body } = res.locals.validated as { body: z.infer<typeof RegisterBody> };
      const result = await authService.register(body);
      res.status(201).json({
        ...result,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        workspace: result.workspaces[0],
      });
    },
  );

  // POST /api/v1/auth/login
  router.post(
    "/auth/login",
    validateRequest({ body: LoginBody }),
    async (_req, res) => {
      const { body } = res.locals.validated as { body: z.infer<typeof LoginBody> };
      const result = await authService.login(body);
      res.status(200).json({
        ...result,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        workspace: result.workspaces[0],
      });
    },
  );

  // POST /api/v1/auth/refresh
  router.post(
    "/auth/refresh",
    validateRequest({ body: RefreshBody }),
    async (_req, res) => {
      const { body } = res.locals.validated as { body: z.infer<typeof RefreshBody> };
      const tokens = await authService.refreshToken(body.refreshToken);
      res.status(200).json(tokens);
    },
  );

  // POST /api/v1/auth/logout
  router.post(
    "/auth/logout",
    validateRequest({ body: LogoutBody }),
    async (req, res) => {
      const { body } = res.locals.validated as { body: z.infer<typeof LogoutBody> };
      // Also accept Bearer token or body.refreshToken
      const refreshToken = body.refreshToken || (req.headers["x-refresh-token"] as string | undefined);
      await authService.logout(refreshToken);
      res.status(200).json({ message: "Logged out successfully" });
    },
  );

  // GET /api/v1/auth/me (Protected)
  router.get(
    "/auth/me",
    authenticate(tokenService),
    async (_req, res) => {
      const authUser = res.locals.user;
      if (!authUser) {
        res.status(401).json({ error: "UNAUTHENTICATED", message: "User not authenticated" });
        return;
      }

      const result = await authService.getCurrentUser(authUser.id);
      res.status(200).json({
        ...result,
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        workspace: result.workspaces[0],
      });
    },
  );

  return router;
}
