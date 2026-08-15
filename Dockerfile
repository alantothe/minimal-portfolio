FROM oven/bun:1.3.0

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends age ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0

CMD ["bun", "run", "start"]
