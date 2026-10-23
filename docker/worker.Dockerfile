# browser-worker: owns Chromium. Playwright's image pins the browser build to the npm version.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 LOG_LEVEL=info
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY sites ./sites
COPY src ./src
USER pwuser
EXPOSE 7900
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:7900/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/browser-worker/main.ts"]
