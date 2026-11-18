FROM node:26-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium \
    WHATSAPP_HEADLESS=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown node:node /app
COPY --chown=node:node package.json package-lock.json ./
USER node
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force
COPY --chown=node:node *.mjs ./
COPY --chown=node:node scripts ./scripts
RUN mkdir -p state .wwebjs_auth .wwebjs_cache

CMD ["node", "bot.mjs"]
