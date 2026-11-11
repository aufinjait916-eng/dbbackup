# Stage 1: Build Frontend and Server
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build client
COPY . .
RUN npm run build

# Stage 2: Production Runtime with PostgreSQL Client Tools
FROM node:22-alpine AS runner

WORKDIR /app

# Install postgresql-client for pg_dump and psql tools
RUN apk add --no-cache postgresql-client bash curl

ENV NODE_ENV=production
ENV PORT=3000

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm install -g tsx

# Copy built frontend assets and server
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts

# Non-root user for security
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/config || exit 1

CMD ["tsx", "server.ts"]
