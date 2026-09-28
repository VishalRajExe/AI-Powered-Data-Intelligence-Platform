import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Redis } from "ioredis";
import { AppError } from "../../common/errors.js";
import type { AccessTokenPayload, AuthTokens, RefreshTokenPayload } from "./auth.types.js";

export interface TokenServiceConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTokenTtlSec?: number | undefined;
  refreshTokenTtlSec?: number | undefined;
  redis?: Redis | undefined;
}

export class TokenService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTokenTtlSec: number;
  private readonly refreshTokenTtlSec: number;
  private readonly redis?: Redis | undefined;
  private readonly inMemoryRevoked = new Set<string>();

  constructor(config: TokenServiceConfig) {
    if (!config.accessSecret || config.accessSecret.length < 32) {
      throw new Error("JWT access secret must be at least 32 characters long");
    }
    if (!config.refreshSecret || config.refreshSecret.length < 32) {
      throw new Error("JWT refresh secret must be at least 32 characters long");
    }

    this.accessSecret = config.accessSecret;
    this.refreshSecret = config.refreshSecret;
    this.accessTokenTtlSec = config.accessTokenTtlSec ?? 900; // 15 minutes
    this.refreshTokenTtlSec = config.refreshTokenTtlSec ?? 604800; // 7 days
    this.redis = config.redis;
  }

  generateTokens(user: { id: string; email: string }, defaultWorkspaceId?: string): AuthTokens {
    const accessToken = this.generateAccessToken(user, defaultWorkspaceId);
    const refreshToken = this.generateRefreshToken(user);

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.accessTokenTtlSec,
    };
  }

  generateAccessToken(user: { id: string; email: string }, defaultWorkspaceId?: string): string {
    const jti = crypto.randomUUID();
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      ...(defaultWorkspaceId ? { defaultWorkspaceId } : {}),
      type: "access",
      jti,
    };

    return jwt.sign(payload, this.accessSecret, {
      expiresIn: this.accessTokenTtlSec,
    });
  }

  generateRefreshToken(user: { id: string }): string {
    const jti = crypto.randomUUID();
    const payload: RefreshTokenPayload = {
      sub: user.id,
      type: "refresh",
      jti,
    };

    return jwt.sign(payload, this.refreshSecret, {
      expiresIn: this.refreshTokenTtlSec,
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, this.accessSecret) as unknown as AccessTokenPayload;
      if (decoded.type !== "access" || !decoded.sub) {
        throw new AppError("Invalid access token structure", 401, "INVALID_TOKEN");
      }
      return decoded;
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError("Access token has expired", 401, "TOKEN_EXPIRED");
      }
      throw new AppError("Invalid access token", 401, "INVALID_TOKEN");
    }
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      const decoded = jwt.verify(token, this.refreshSecret) as unknown as RefreshTokenPayload;
      if (decoded.type !== "refresh" || !decoded.sub || !decoded.jti) {
        throw new AppError("Invalid refresh token structure", 401, "INVALID_TOKEN");
      }

      const revoked = await this.isRevoked(decoded.jti);
      if (revoked) {
        throw new AppError("Refresh token has been revoked", 401, "TOKEN_REVOKED");
      }

      return decoded;
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError("Refresh token has expired", 401, "TOKEN_EXPIRED");
      }
      throw new AppError("Invalid refresh token", 401, "INVALID_TOKEN");
    }
  }

  async revokeToken(tokenOrJti: string): Promise<void> {
    let jti = tokenOrJti;

    // If it looks like a JWT token string (has two dots), decode it to get jti
    if (tokenOrJti.split(".").length === 3) {
      try {
        const decoded = jwt.decode(tokenOrJti) as { jti?: string } | null;
        if (decoded?.jti) {
          jti = decoded.jti;
        }
      } catch {
        // If decoding fails, treat the string directly as jti
      }
    }

    this.inMemoryRevoked.add(jti);

    if (this.redis) {
      try {
        await this.redis.set(`aidp:revoked_token:${jti}`, "1", "EX", this.refreshTokenTtlSec);
      } catch {
        // Fallback to in-memory store if Redis write fails
      }
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    if (this.inMemoryRevoked.has(jti)) return true;

    if (this.redis) {
      try {
        const exists = await this.redis.exists(`aidp:revoked_token:${jti}`);
        if (exists) {
          this.inMemoryRevoked.add(jti);
          return true;
        }
      } catch {
        // Fallback to in-memory check if Redis query fails
      }
    }

    return false;
  }
}
