import type { WorkspaceRole, WorkspaceStatus, UserStatus } from "@prisma/client";

export interface UserView {
  id: string;
  email: string;
  name: string | null;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  status: WorkspaceStatus;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number; // in seconds
}

export interface AuthResponse {
  user: UserView;
  workspaces: WorkspaceSummary[];
  tokens: AuthTokens;
}

export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
  defaultWorkspaceId?: string | undefined;
  type: "access";
  jti?: string | undefined;
}

export interface RefreshTokenPayload {
  sub: string; // userId
  type: "refresh";
  jti: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  defaultWorkspaceId?: string | undefined;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string | undefined;
  workspaceName?: string | undefined;
}

export interface LoginInput {
  email: string;
  password: string;
}
