# Build the dashboard, then serve it (static + /api proxy) from the node base image.
# No second base image (no nginx) -> reuses the node image the gateway already pulled.

# 1) Build stage.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
RUN npm run build -w @conduit/dashboard

# 2) Serve stage (tiny dependency-free node server).
FROM node:20-bookworm-slim AS serve
WORKDIR /app
COPY --from=build /app/apps/dashboard/dist ./dist
COPY apps/dashboard/server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
