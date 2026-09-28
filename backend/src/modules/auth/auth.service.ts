import crypto from "node:crypto";
import type { PrismaClient, User, Workspace, WorkspaceMember } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import type {
  AuthResponse,
  AuthTokens,
  LoginInput,
  RegisterInput,
  UserView,
  WorkspaceSummary,
} from "./auth.types.js";
import { comparePassword, hashPassword } from "./password.js";
import type { TokenService } from "./token.service.js";

function sanitizeUser(user: User): UserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function mapWorkspace(
  workspace: Workspace,
  membership: WorkspaceMember,
): WorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role: membership.role,
    status: workspace.status,
    createdAt: workspace.createdAt.toISOString(),
  };
}

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${base}-${suffix}`;
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokenService: TokenService,
  ) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const email = input.email.trim().toLowerCase();

    if (!input.password || input.password.length < 8) {
      throw new AppError(
        "Password must be at least 8 characters long",
        400,
        "INVALID_PASSWORD",
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      throw new AppError("A user with this email already exists", 409, "EMAIL_ALREADY_EXISTS");
    }

    const passwordHash = await hashPassword(input.password);
    const userId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();

    const workspaceName =
      input.workspaceName?.trim() ||
      (input.name ? `${input.name}'s Workspace` : "Default Workspace");
    const slug = generateSlug(workspaceName);

    // Create user, default workspace, and owner membership in an atomic transaction
    const [user, workspace, member] = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          id: userId,
          email,
          passwordHash,
          name: input.name?.trim() || null,
          status: "ACTIVE",
        },
      });

      const ws = await tx.workspace.create({
        data: {
          id: workspaceId,
          name: workspaceName,
          slug,
          createdById: userId,
          status: "ACTIVE",
        },
      });

      const m = await tx.workspaceMember.create({
        data: {
          workspaceId: ws.id,
          userId: u.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      });

      return [u, ws, m];
    });

    const userView = sanitizeUser(user);
    const workspaceSummary = mapWorkspace(workspace, member);
    const tokens = this.tokenService.generateTokens(userView, workspace.id);

    return {
      user: userView,
      workspaces: [workspaceSummary],
      tokens,
    };
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const email = input.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { status: "ACTIVE" },
          include: { workspace: true },
        },
      },
    });

    if (!user || !user.passwordHash) {
      throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }

    const valid = await comparePassword(input.password, user.passwordHash);
    if (!valid) {
      throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }

    if (user.status === "DISABLED") {
      throw new AppError("Your account has been disabled", 403, "USER_DISABLED");
    }

    const activeWorkspaces = user.memberships
      .filter((m) => m.workspace.status === "ACTIVE")
      .map((m) => mapWorkspace(m.workspace, m));

    const defaultWorkspaceId = activeWorkspaces[0]?.id;
    const userView = sanitizeUser(user);
    const tokens = this.tokenService.generateTokens(userView, defaultWorkspaceId);

    return {
      user: userView,
      workspaces: activeWorkspaces,
      tokens,
    };
  }

  async refreshToken(refreshTokenStr: string): Promise<AuthTokens> {
    const payload = await this.tokenService.verifyRefreshToken(refreshTokenStr);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: {
          where: { status: "ACTIVE" },
          select: { workspaceId: true },
        },
      },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new AppError("User account is not active", 401, "USER_INACTIVE");
    }

    // Revoke old refresh token on rotation
    await this.tokenService.revokeToken(payload.jti);

    const defaultWorkspaceId = user.memberships[0]?.workspaceId;
    return this.tokenService.generateTokens(
      { id: user.id, email: user.email },
      defaultWorkspaceId,
    );
  }

  async logout(refreshTokenStr?: string): Promise<void> {
    if (refreshTokenStr) {
      await this.tokenService.revokeToken(refreshTokenStr);
    }
  }

  async getCurrentUser(
    userId: string,
  ): Promise<{ user: UserView; workspaces: WorkspaceSummary[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: "ACTIVE" },
          include: { workspace: true },
        },
      },
    });

    if (!user) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    const activeWorkspaces = user.memberships
      .filter((m) => m.workspace.status === "ACTIVE")
      .map((m) => mapWorkspace(m.workspace, m));

    return {
      user: sanitizeUser(user),
      workspaces: activeWorkspaces,
    };
  }
}
