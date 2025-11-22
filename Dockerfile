FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Build (if necessary, though agents are tsx)
# RUN npm run build 

# Default command runs the Conductor
# You can override this in Railway to run other agents (e.g. "npm run agent:voice")
CMD ["npm", "run", "agent:conductor"]
