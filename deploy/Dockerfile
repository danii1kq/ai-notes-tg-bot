# syntax=docker/dockerfile:1

FROM node:22-alpine

WORKDIR /app

# Зависимости отдельным слоем — пересобираются только при изменении манифестов.
COPY app/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY app/ ./

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080

CMD ["node", "index.js"]
