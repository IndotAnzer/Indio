FROM node:lts-alpine

RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY source/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY source/ ./

EXPOSE 3000

CMD ["/sbin/tini", "--", "node", "app.js"]
