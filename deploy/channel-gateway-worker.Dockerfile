FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /app

COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node app/product-studio-types.ts ./app/product-studio-types.ts
COPY --chown=node:node lib ./lib
COPY --chown=node:node prompts ./prompts
COPY --chown=node:node scripts ./scripts

ENV NODE_ENV=production
ENV PORT=8080

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SELLERPILOT_GATEWAY_HEALTH_PORT||process.env.PORT||8080)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "scripts/ai-cli-worker.mjs", "--gateway-only"]
