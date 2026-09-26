# Render free-tier variant of docker/web.Dockerfile. Render Docker builds
# cannot pass --build-arg, so this copy bakes the free-tier API URL (the
# blueprint's service names fix the URLs). Keep in sync with
# docker/web.Dockerfile — the only intended difference is the ARG default
# below and this header.
ARG NEXT_PUBLIC_API_BASE=https://nexpos-api.onrender.com
FROM node:24-slim AS build
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
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
COPY apps/web ./apps/web
RUN pnpm --filter @pos/web build

FROM node:24-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY --from=build /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web ./apps/web
EXPOSE 3000
USER node
WORKDIR /app/apps/web
# node is PID 1 so SIGTERM reaches next directly (a pnpm wrapper would
# swallow the signal).
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
