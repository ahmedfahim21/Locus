# Locus API and call worker (same image; the command picks which).
# Build from the repository root:  docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim

# ffmpeg reads walk videos; ca-certificates for outbound HTTPS (Supabase, Sarvam, OpenAI, LiveKit).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /app
# Manifests first so dependency installs are cached between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY patches ./patches
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @locus/api...

COPY apps/api ./apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 8787
CMD ["pnpm", "start"]
