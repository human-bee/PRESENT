FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY deploy/interview-studio/package.json ./package.json
RUN npm install --no-audit --no-fund
COPY packages/contracts/src/interview*.ts ./packages/contracts/src/
COPY services/kernel/src/interview*.ts ./services/kernel/src/
COPY src/lib/interviews ./src/lib/interviews
COPY src/lib/agents/interview*.ts src/lib/agents/openai-readiness.ts ./src/lib/agents/
COPY src/lib/server/traffic-guards.ts ./src/lib/server/traffic-guards.ts
COPY src/lib/supabase/server/request-user.ts ./src/lib/supabase/server/request-user.ts
COPY src/lib/supabase/auth-headers.ts ./src/lib/supabase/auth-headers.ts
COPY src/lib/supabase.ts ./src/lib/supabase.ts
COPY src/components/interviews ./src/components/interviews
COPY src/app/api/interviews ./src/app/api/interviews
COPY src/app/interviews ./src/app/interviews
COPY public/interview-assets ./public/interview-assets
COPY public/icon.svg ./public/icon.svg
COPY deploy/interview-studio/tsconfig.json deploy/interview-studio/next.config.ts ./
COPY deploy/interview-studio/layout.tsx ./src/app/layout.tsx
COPY deploy/interview-studio/home.tsx ./src/app/page.tsx
COPY deploy/interview-studio/bootstrap.mjs deploy/interview-studio/start.sh ./
COPY deploy/interview-studio/smoke.ts ./smoke.ts
RUN mkdir -p src/app/healthz && printf 'export function GET(){return Response.json({status:"ok",service:"interview-studio"})}' > src/app/healthz/route.ts
RUN npm run build
CMD ["sh", "start.sh"]
