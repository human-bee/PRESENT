FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Build (if necessary, though agents are tsx)
# RUN npm run build 

# Railway uses SERVICE_TYPE to select the entrypoint in scripts/start-service.sh
CMD ["sh", "scripts/start-service.sh"]
