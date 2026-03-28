# ---------------------------------------------------------------------------
# DEVROOM — Production Dockerfile
# ---------------------------------------------------------------------------
# Multi-stage build: install deps + build Next.js, then run with minimal layer
# ---------------------------------------------------------------------------

# -- Stage 1: Dependencies --------------------------------------------------
FROM node:20-bookworm-slim AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Native build tools for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# -- Stage 2: Build ---------------------------------------------------------
FROM node:20-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build

# -- Stage 3: Production ----------------------------------------------------
FROM node:20-bookworm-slim AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

# Git is required at runtime (simple-git, worktree operations)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally (can't mount macOS binary into Linux container)
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Copy built application
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/server.ts ./
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/.devroom ./.devroom
COPY --from=build /app/CLAUDE.md ./

ENV NODE_ENV=production
ENV DEVROOM_PORT=7777
ENV DEVROOM_HOST=0.0.0.0

EXPOSE 7777

CMD ["pnpm", "start"]
