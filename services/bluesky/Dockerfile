FROM node:20-alpine
WORKDIR /services/bluesky
COPY bluesky/package*.json ./
RUN npm install
COPY utils ./utils
COPY bluesky/ .
CMD ["node", "index.js"]
