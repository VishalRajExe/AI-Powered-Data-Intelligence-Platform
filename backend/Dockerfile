# ==============================================================================
# Production Dockerfile for AI-Powered Data Intelligence Platform Backend
# Multi-stage build for optimal image size and hardened security
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build & Dependencies
# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build essentials and OpenSSL for Prisma
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace package manifests
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY packages/firecrawl-agent-core/package.json ./packages/firecrawl-agent-core/

# Install all workspace dependencies
RUN npm ci

# Copy source trees and configurations
COPY packages/firecrawl-agent-core ./packages/firecrawl-agent-core
COPY backend ./backend

# Generate Prisma Client
RUN npm run db:generate --workspace @aidp/backend

# Build local packages and backend service
RUN npm run build --workspace @aidp/firecrawl-agent-core
RUN npm run build --workspace @aidp/backend

# Prune devDependencies for production
RUN npm prune --omit=dev

# ------------------------------------------------------------------------------
# Stage 2: Hardened Production Runtime
# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

WORKDIR /app/backend

# Install runtime dependencies: OpenSSL (for Prisma), CA certs, curl (for healthchecks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=3000

# Create unprivileged storage directory and set permissions
RUN mkdir -p /app/backend/storage/exports && \
    chown -R node:node /app

# Copy production artifacts from builder
COPY --from=builder --chown=node:node /app/node_modules /app/node_modules
COPY --from=builder --chown=node:node /app/packages/firecrawl-agent-core/dist /app/packages/firecrawl-agent-core/dist
COPY --from=builder --chown=node:node /app/packages/firecrawl-agent-core/package.json /app/packages/firecrawl-agent-core/package.json
COPY --from=builder --chown=node:node /app/backend/dist /app/backend/dist
COPY --from=builder --chown=node:node /app/backend/package.json /app/backend/package.json
COPY --from=builder --chown=node:node /app/backend/prisma /app/backend/prisma

# Run as non-root user for security
USER node

EXPOSE 3000

# Health check probe
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/health || exit 1

# Start backend server
CMD ["node", "dist/server.js"]
