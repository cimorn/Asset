FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts
COPY build.mjs index.html vite.config.mjs tsconfig.json postcss.config.mjs ./
COPY app ./app
COPY components ./components
COPY hooks ./hooks
COPY lib ./lib
COPY shared ./shared
COPY src ./src
COPY public ./public
RUN node node_modules/typescript/bin/tsc --noEmit && node build.mjs

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/cimorn/AssetManager"
COPY LICENSE NOTICE ./
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build --chown=node:node /build/dist ./dist
COPY --from=build --chown=node:node /build/server/runtime ./server/runtime
COPY --chown=node:node server/auth.mjs server/journal.mjs server/mongo-ledger.mjs server/server.mjs server/index.mjs server/feishu-ledger.mjs server/feishu-merge.mjs ./server/
COPY --chown=node:node shared ./shared
COPY --chown=node:node scripts/mongo-maintenance.mjs scripts/init-ledger.mjs ./scripts/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
