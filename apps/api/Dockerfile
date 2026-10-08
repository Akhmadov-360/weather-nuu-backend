# Build context is the monorepo root (see docker-compose.yml: context: ../..)
# because this workspace depends on @weather/contracts and @weather/tsconfig,
# and `turbo prune` needs the full pnpm workspace to compute the subset
# that @weather/api actually needs (apps/web, packages/eslint-config etc.
# get dropped, so `pnpm install --frozen-lockfile` doesn't choke on
# workspace members that were never copied in).

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# --- prune: compute the minimal workspace (source + lockfile) for @weather/api ---
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo prune @weather/api --docker

# --- deps: install from the pruned manifests only, so this layer stays
# cached across source edits and only busts when a dependency changes ---
FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# --- runner: overlay the pruned real source on top of the installed deps ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app ./
COPY --from=pruner /app/out/full/ .

# No tsc build step: @weather/contracts ships TS source with no dist/build
# script, so the workspace runs through tsx, which transpiles it and
# apps/api on the fly — the same way `pnpm dev` already runs it locally.
# `node dist/server.js` would fail to resolve @weather/contracts at runtime.
WORKDIR /app/apps/api
EXPOSE 8002
USER node

CMD ["pnpm", "exec", "tsx", "src/server.ts"]
