FROM node:24-alpine
WORKDIR /services/pinterest
COPY pinterest/package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY utils ./utils
COPY pinterest/ .
CMD ["node", "index.js"]
