# credential-broker (also used for the dev-only mock shop). No browser, no native helper access.
FROM node:24-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 LOG_LEVEL=info
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY migrations ./migrations
COPY sites ./sites
COPY src ./src
COPY mock-shop ./mock-shop
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 7800 7801
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:7800/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/broker/main.ts"]
