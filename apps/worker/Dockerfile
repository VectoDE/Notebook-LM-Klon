# RelationNotes on Node.js: web app and API from one process on one port (8787).
#
# Base image: node:26.13.1-alpine (Node 26 "Lithium", LTS since v26.13.0), pinned to the
# multi-arch OCI index digest read from registry-1.docker.io on 2026-11-13.
# Stage "build" compiles everything; stage "runner" only receives the build output:
#   apps/worker/dist/node-server.js  (API server, all dependencies bundled, no tsx)
#   apps/worker/migrations            (applied at start)
#   apps/web/dist                     (static web app)
# No node_modules, no package manager and no sources end up in the runtime image.
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS base

FROM base AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Node 25+ no longer ships corepack, so pnpm is installed at the exact version from
# package.json "packageManager" (build stage only).
RUN npm install --global --no-fund --no-audit pnpm@11.23.0
WORKDIR /app

# Public Turnstile site key for the browser widget. Vite bakes it into the web bundle at
# build time, so it is a build argument, not a runtime variable. Left empty, the image is
# built without the widget: guest login and magic link then stay blocked.
ARG VITE_TURNSTILE_SITE_KEY=""
ENV VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @notebook-lm/web build && pnpm --filter @notebook-lm/worker build:node

FROM base AS runner
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/app/.data \
    STATIC_DIR=/app/apps/web/dist
WORKDIR /app

RUN mkdir -p /app/.data && chown node:node /app/.data

COPY --from=build --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=node:node /app/apps/worker/migrations ./apps/worker/migrations
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist

USER node
EXPOSE 8787
VOLUME ["/app/.data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/worker/dist/node-server.js"]
