FROM node:20-alpine
WORKDIR /services/scheduler
COPY scheduler/package*.json ./
RUN npm install
COPY utils ./utils
COPY scheduler/ .
CMD ["node", "index.js"]
