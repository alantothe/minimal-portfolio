FROM oven/bun:1.3.0

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0

CMD ["bun", "run", "start"]
