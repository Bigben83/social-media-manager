FROM node:24-alpine
WORKDIR /services/instagram
COPY instagram/package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY utils ./utils
COPY instagram/ .
CMD ["node", "index.js"]
