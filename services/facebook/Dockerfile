FROM node:24-alpine
WORKDIR /services/facebook
COPY facebook/package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY utils ./utils
COPY facebook/ .
CMD ["node", "index.js"]
