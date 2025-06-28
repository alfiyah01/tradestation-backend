# =====================
# TRADESTATION PREMIUM - DOCKER CONFIGURATION
# Multi-stage build for production optimization
# =====================

# Stage 1: Build dependencies
FROM node:18-alpine AS dependencies

# Set working directory
WORKDIR /app

# Install system dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev

# Copy package files
COPY package*.json ./

# Install dependencies with production optimization
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Production image
FROM node:18-alpine AS production

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Asia/Jakarta

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S tradestation -u 1001

# Set working directory
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    cairo \
    jpeg \
    pango \
    musl \
    giflib \
    pixman \
    pangomm \
    libjpeg-turbo \
    freetype \
    tzdata \
    curl

# Copy dependencies from build stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy application code
COPY --chown=tradestation:nodejs . .

# Create necessary directories
RUN mkdir -p /app/uploads /app/backups /app/logs /app/assets && \
    chown -R tradestation:nodejs /app/uploads /app/backups /app/logs /app/assets

# Create health check script
RUN echo '#!/bin/sh\ncurl -f http://localhost:3000/api/health || exit 1' > /app/healthcheck.sh && \
    chmod +x /app/healthcheck.sh && \
    chown tradestation:nodejs /app/healthcheck.sh

# Switch to non-root user
USER tradestation

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["/app/healthcheck.sh"]

# Volume for persistent data
VOLUME ["/app/uploads", "/app/backups", "/app/logs"]

# Start application
CMD ["node", "server.js"]

# Metadata
LABEL maintainer="TradeStation Development Team" \
      version="3.0.0" \
      description="TradeStation Premium Digital Contract System" \
      org.opencontainers.image.title="TradeStation Premium" \
      org.opencontainers.image.description="Digital Contract System with Advanced Features" \
      org.opencontainers.image.version="3.0.0" \
      org.opencontainers.image.vendor="TradeStation" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/tradestation/premium-contract-system"
