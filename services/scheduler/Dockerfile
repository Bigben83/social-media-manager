FROM node:24-alpine
WORKDIR /services/scheduler
COPY scheduler/package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY utils ./utils
COPY scheduler/ .
CMD ["node", "index.js"]
