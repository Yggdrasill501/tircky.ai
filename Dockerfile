# syntax=docker/dockerfile:1

# Multi-stage so the runtime image carries no toolchain and no source.
# Next's standalone output traces exactly the node_modules it needs, which is
# the difference between a ~180 MB image and a ~1.2 GB one.

ARG NODE_VERSION=22.22.0

# ---- deps -------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# No database or storage credentials here, and none are needed: env access and
# every connection are lazy, so `next build` can import each route module to
# collect page data without reaching a dependency.
RUN pnpm build

# ---- migrate ----------------------------------------------------------------
# A SEPARATE target, not extra layers on the runtime image.
#
# kysely-ctl and the TypeScript migrations need the full dependency tree and a
# TS loader; carrying those into the serving image tripled its size for code
# that runs once per deploy. Build this target for the migration job:
#
#   docker build --target migrate -t tricky:migrate .
#   docker run --rm -e DATABASE_ADMIN_URL=... tricky:migrate
#
# The deploy runs it to completion BEFORE the new service version starts, so
# the schema is never behind the code that expects it.
FROM build AS migrate
WORKDIR /app
ENV NODE_ENV=production
CMD ["pnpm", "exec", "kysely", "migrate", "latest"]

# ---- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
