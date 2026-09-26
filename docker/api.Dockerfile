# Production API image. The API intentionally runs TypeScript via tsx (there
# is no compiled artifact), so the workspace installs in full and starts from
# source. Build from the repository root:
#   docker build -f docker/api.Dockerfile -t nexpos-api .
# Runtime configuration arrives through environment variables only — no
# .env file is copied into the image.
FROM node:24-slim
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Bake the pinned pnpm (packageManager field) so the image starts without a
# network round-trip to corepack.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
# The whole workspace manifest set is required for pnpm's frozen-lockfile
# check (every importer in the lockfile must exist), even though only the
# API's sources are copied below.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/types/package.json packages/types/
COPY packages/validation/package.json packages/validation/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
# The migration runner rides along so the same image can be used as a
# one-shot migration job (compose migrate service / platform release step):
#   docker run --rm -e DATABASE_URL=… nexpos-api node scripts/apply-migrations.mjs
COPY scripts/apply-migrations.mjs ./scripts/apply-migrations.mjs
# NODE_ENV comes after the install step: pnpm skips devDependencies when it
# is set, and this API runs from source via the tsx devDependency.
ENV NODE_ENV=production
EXPOSE 3001
USER node
WORKDIR /app/apps/api
# node is PID 1 so SIGTERM reaches the process that owns the shutdown hooks
# (nest closes the pool); a pnpm wrapper would swallow the signal.
CMD ["node", "--import", "tsx", "src/main.ts"]
