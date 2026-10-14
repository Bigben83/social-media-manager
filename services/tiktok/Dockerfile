FROM node:24-alpine
WORKDIR /services/tiktok
COPY tiktok/package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY utils ./utils
COPY tiktok/ .
CMD ["node", "index.js"]
