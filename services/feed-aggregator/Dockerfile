FROM node:24-alpine
WORKDIR /services/feed-aggregator
COPY feed-aggregator/package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY utils ./utils
COPY feed-aggregator/ .
CMD ["node", "index.js"]
