# syntax=docker/dockerfile:1

##
## Strapi 5 production image for Roští.cz Docker Stacks (build for linux/amd64).
##
## Multi-stage: the builder installs every dependency and compiles the admin
## panel; the runtime keeps production dependencies only, so the shipped image
## stays small. PostgreSQL runs as a separate service — see docker-compose.yml.
##

# ---- build stage -------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /opt/app

# better-sqlite3 and sharp are native modules and need a toolchain to compile.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10 --activate

# Install deps first so this layer is cached until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Build the admin panel (needs the full source and the dev dependencies).
COPY . .
RUN pnpm build

# Strip dev dependencies so only the runtime ones are copied forward.
RUN pnpm prune --prod

# ---- runtime stage -----------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# Strapi's default V8 heap is ~1.4 GB; raise it (the Roští Medium tier has 4 GB).
ENV NODE_OPTIONS=--max-old-space-size=2048
WORKDIR /opt/app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY --from=builder /opt/app ./

# Uploads live on a bind-mounted host directory (see compose); make sure the
# mount point exists even before the first file is written.
RUN mkdir -p public/uploads

EXPOSE 1337
CMD ["pnpm", "start"]
