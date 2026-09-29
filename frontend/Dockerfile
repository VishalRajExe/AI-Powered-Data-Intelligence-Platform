FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `next build` resolves the /api/v1 rewrite into .next/routes-manifest.json, so the
# backend origin has to be correct at BUILD time - and again at runtime. Setting it only
# on `next start` silently keeps whatever was baked into the image.
ARG BACKEND_ORIGIN=http://localhost:8080
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN}

RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/next.config.js ./next.config.js
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["npx", "next", "start", "-H", "0.0.0.0"]
