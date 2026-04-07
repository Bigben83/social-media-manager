FROM node:20-alpine
WORKDIR /services/feed-aggregator
COPY feed-aggregator/package*.json ./
RUN npm install
COPY utils ./utils
COPY feed-aggregator/ .
CMD ["node", "index.js"]
