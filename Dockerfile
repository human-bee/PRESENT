FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# This is a public client license, not an API secret. Railway passes declared build arguments.
ARG VITE_TLDRAW_LICENSE_KEY
RUN npm run build
ENV NODE_ENV=production
EXPOSE 4317
CMD ["node", "--import", "tsx", "server/index.ts"]
