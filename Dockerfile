FROM node:22-bookworm-slim

WORKDIR /app

# Ensure TLS trust store exists for LiveKit Cloud HTTPS calls.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies (including build-time deps for Next.js)
COPY package.json package-lock.json ./
# `npm ci` is strict about lockfile peer resolution and can fail depending on npm version.
# For Railway we prefer a tolerant install that matches Vercel's build behavior.
RUN npm install

# Copy source code
COPY . .

# Build Next.js artifacts so web deployments always serve the current image commit.
RUN npm run build

# Railway uses SERVICE_TYPE to select the entrypoint in scripts/start-service.sh
CMD ["sh", "scripts/start-service.sh"]
