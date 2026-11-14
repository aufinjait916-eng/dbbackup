# Stage 1: Build Frontend (runs natively on the build machine for maximum speed and compatibility)
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy package manifests and install dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy source code and build client assets
COPY . .
RUN if [ ! -d "dist" ] || [ ! -f "dist/index.html" ]; then \
      npm run build; \
    fi

# Stage 2: Production Runtime with PostgreSQL Client Tools
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Install postgresql-client (pg_dump, psql) and curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    curl \
    bash \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

# Copy package manifests and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps && npm install -g tsx

# Copy built frontend assets and server entry point
COPY --from=builder /app/dist ./dist
COPY server.ts ./server.ts
COPY server ./server

# Create persistent data directory for auth store & audit logs
RUN mkdir -p /app/data && chown -R node:node /app/data

# Run as non-root user for security
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["tsx", "server.ts"]
