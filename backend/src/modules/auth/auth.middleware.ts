import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { PrismaClient, WorkspaceRole } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import type { AuthenticatedUser } from "./auth.types.js";
import type { TokenService } from "./token.service.js";


const ROLE_RANKS: Record<WorkspaceRole, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/**
 * Authentication middleware: verifies Bearer access token and attaches authenticated user.
 */
export function authenticate(tokenService: TokenService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new AppError("Authorization header is required", 401, "UNAUTHENTICATED");
    }

    if (!authHeader.startsWith("Bearer ")) {
      throw new AppError(
        "Authorization header must use Bearer scheme",
        401,
        "INVALID_AUTH_HEADER",
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new AppError("Access token is missing", 401, "UNAUTHENTICATED");
    }

    const payload = tokenService.verifyAccessToken(token);

    const authenticatedUser: AuthenticatedUser = {
      id: payload.sub,
      email: payload.email,
      ...(payload.defaultWorkspaceId ? { defaultWorkspaceId: payload.defaultWorkspaceId } : {}),
    };

    res.locals.user = authenticatedUser;
    next();
  };
}

/**
 * Optional authentication middleware: attaches user if valid token present, otherwise passes.
 */
export function optionalAuthenticate(tokenService: TokenService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.slice(7).trim();
        const payload = tokenService.verifyAccessToken(token);
        res.locals.user = {
          id: payload.sub,
          email: payload.email,
          ...(payload.defaultWorkspaceId ? { defaultWorkspaceId: payload.defaultWorkspaceId } : {}),
        };
      } catch {
        // In optional mode, ignore error and continue unauthenticated
      }
    }
    next();
  };
}

/**
 * Workspace authorization middleware: ensures the user has active membership in the target workspace.
 */
export function requireWorkspaceAccess(
  prisma: PrismaClient,
  options?: { minRole?: WorkspaceRole | undefined },
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = res.locals.user;
    if (!user) {
      throw new AppError("Authentication required for workspace access", 401, "UNAUTHENTICATED");
    }

    const headerWs = req.headers["x-workspace-id"];
    const workspaceId =
      (req.params.workspaceId as string | undefined) ||
      (req.params.id && req.baseUrl.includes("/workspaces") ? req.params.id : undefined) ||
      (typeof headerWs === "string" ? headerWs : undefined) ||
      (req.query.workspaceId as string | undefined) ||
      (req.body && typeof req.body === "object" ? req.body.workspaceId : undefined) ||
      user.defaultWorkspaceId;

    if (!workspaceId || typeof workspaceId !== "string") {
      throw new AppError("Workspace ID is required", 400, "WORKSPACE_ID_REQUIRED");
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: user.id,
        },
      },
      include: {
        workspace: true,
      },
    });

    if (!membership || membership.status !== "ACTIVE" || membership.workspace.status !== "ACTIVE") {
      throw new AppError(
        "User does not have active access to this workspace",
        403,
        "WORKSPACE_ACCESS_DENIED",
      );
    }

    if (options?.minRole) {
      const userRank = ROLE_RANKS[membership.role] ?? 0;
      const requiredRank = ROLE_RANKS[options.minRole] ?? 0;
      if (userRank < requiredRank) {
        throw new AppError(
          `Insufficient permissions: requires ${options.minRole} role`,
          403,
          "INSUFFICIENT_PERMISSIONS",
        );
      }
    }

    res.locals.workspaceId = workspaceId;
    res.locals.workspaceRole = membership.role;
    next();
  };
}

/**
 * Identity protection middleware: ensures client-supplied user IDs match the authenticated user.
 * Rejects impersonation attempts with 403 FORBIDDEN_USER_MISMATCH.
 */
export function enforceClientIdentity(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authUser = res.locals.user;
    if (!authUser) {
      return next();
    }

    // Check query params
    const queryUserId = req.query.userId;
    if (typeof queryUserId === "string" && queryUserId !== authUser.id) {
      throw new AppError(
        "Client-supplied userId does not match authenticated user",
        403,
        "FORBIDDEN_USER_MISMATCH",
      );
    }

    // Check body parameters (userId, createdById, requestedById)
    if (req.body && typeof req.body === "object") {
      if (req.body.userId && req.body.userId !== authUser.id) {
        throw new AppError(
          "Client-supplied userId does not match authenticated user",
          403,
          "FORBIDDEN_USER_MISMATCH",
        );
      }
      if (req.body.createdById && req.body.createdById !== authUser.id) {
        throw new AppError(
          "Client-supplied createdById does not match authenticated user",
          403,
          "FORBIDDEN_USER_MISMATCH",
        );
      }
      if (req.body.requestedById && req.body.requestedById !== authUser.id) {
        throw new AppError(
          "Client-supplied requestedById does not match authenticated user",
          403,
          "FORBIDDEN_USER_MISMATCH",
        );
      }
    }

    next();
  };
}
