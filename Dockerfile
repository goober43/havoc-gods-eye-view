# HAVOC God View — Vite preview (API proxies stay attached).
FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=4173
EXPOSE 4173
CMD ["npm", "run", "preview"]
