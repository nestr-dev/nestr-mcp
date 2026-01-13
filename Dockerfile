# Nestr MCP Server - Production Dockerfile
# Serves the hosted MCP service at mcp.nestr.io

FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/build ./build

# Copy web assets
COPY web/ ./web/

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestr -u 1001 -G nodejs

USER nestr

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Start HTTP server
CMD ["node", "build/http.js"]
