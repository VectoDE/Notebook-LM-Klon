# Multi-stage reproducible Dockerfile for NotebookLM Clone (Node.js runtime)
# Target architecture: linux/amd64, linux/arm64
# Base image pinned with sha256 digest
FROM node:22-alpine@sha256:d9b23f2ea07d0831ce91fa816e81254dd98ec15638a16d0012285db2d6ae7f0d AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Stage 1: Dependencies and build
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm -r build

# Stage 2: Production runner
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

WORKDIR /app

# Setup non-root user and persistent data dir
RUN mkdir -p /app/.data && chown -R node:node /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps ./apps

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8787/api/v1/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "--import", "tsx", "apps/worker/src/node-server.ts"]
