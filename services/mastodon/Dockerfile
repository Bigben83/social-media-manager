FROM node:20-alpine
WORKDIR /services/mastodon
COPY mastodon/package*.json ./
RUN npm install
COPY utils ./utils
COPY mastodon/ .
CMD ["node", "index.js"]
