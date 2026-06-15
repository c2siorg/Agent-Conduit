# Multi-stage build for the Agent Conduit gateway (single self-hosted process).

# 1) Build stage — install workspaces & compile TypeScript.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
RUN npm run build

# 2) Runtime stage — production deps + compiled output + migrations.
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --omit=dev
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps ./apps
# Migrations are read at startup by the storage driver — they must be in the image.
COPY migrations ./migrations
# Run as the non-root user provided by the base image.
USER node
EXPOSE 8443
CMD ["node", "apps/server/dist/index.js"]

# Optional demo-agent target (referenced by the docker-compose `demo` profile).
FROM runtime AS demo-agent
CMD ["node", "packages/sdk/dist/examples/demoAgent.js"]
