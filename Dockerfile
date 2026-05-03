# Multi-stage. The builder stage carries dev deps; the runtime stage carries
# only what's needed to run, plus the system libs Chromium needs.

# ---- builder ----------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Skip Chromium download here — we install it system-wide in the runtime
# stage and point Puppeteer at it via PUPPETEER_EXECUTABLE_PATH.
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Chromium + the minimum fonts/libs Puppeteer needs on Debian slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      libnss3 \
      libatk-bridge2.0-0 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxrandr2 \
      libgbm1 \
      libpango-1.0-0 \
      libasound2 \
      tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    LOG_LEVEL=info

WORKDIR /app

# Run as non-root.
RUN useradd --system --create-home --shell /usr/sbin/nologin psx \
 && mkdir -p /app/logs /app/state \
 && chown -R psx:psx /app

COPY --from=builder --chown=psx:psx /app/node_modules ./node_modules
COPY --chown=psx:psx package*.json ./
COPY --chown=psx:psx src ./src
COPY --chown=psx:psx scripts ./scripts
COPY --chown=psx:psx config.example.json ./

USER psx

# Mount your config.json and a writable state dir at runtime, e.g.:
#   docker run --rm \
#     -v $PWD/config.json:/app/config.json:ro \
#     -v psx-state:/app/state \
#     ghcr.io/your-username/psx-dividend-alert
ENV PSX_ALERT_CONFIG=/app/config.json

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
