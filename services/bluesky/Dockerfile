FROM node:24-alpine
WORKDIR /services/bluesky
COPY bluesky/package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY utils ./utils
COPY bluesky/ .
CMD ["node", "index.js"]
