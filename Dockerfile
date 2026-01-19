# Build stage
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

# Build
RUN npm run build

# Production stage
FROM node:22-bookworm-slim AS production

# Install git and Claude Code dependencies
RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Copy package files and install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations

# Create data directories
RUN mkdir -p /data /workspaces

# Set environment variables
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/orcha.db
ENV WORKSPACE_DIR=/workspaces

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run as non-root user
RUN useradd -m -s /bin/bash orcha
RUN chown -R orcha:orcha /app /data /workspaces
USER orcha

# Start the server
CMD ["node", "dist/index.js"]
