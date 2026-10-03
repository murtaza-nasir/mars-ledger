# syntax=docker/dockerfile:1
# Mars Ledger: the app image (web client + server). The full-game engine is a separate image (deploy/engine-image.sh).
#
#   docker build -t mars-ledger:local .
#
# The build fetches the card and board data from the open-source engine at the commit in ENGINE_COMMIT
# (npm run fetch-data), so it needs network access to github.com. BUILD_SHA (optional) is the commit the build id
# shows, e.g. --build-arg BUILD_SHA=$(git rev-parse --short=8 HEAD).

FROM node:26-alpine AS build
RUN apk add --no-cache git
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# 1. The engine-derived data: cached until ENGINE_COMMIT or the extract tools change. The clone is dropped after.
COPY ENGINE_COMMIT ./
COPY tools/fetch-data.mjs tools/check-data.mjs tools/check-data.d.mts tools/extract-cards.ts tools/extract-boards.ts tools/build-cards.ts ./tools/
RUN node tools/fetch-data.mjs --extract-only && rm -rf vendor
# 2. The app, then the card packs (engine data plus cards/overrides) and the bundles.
COPY index.html vite.config.ts tsconfig.json ./
COPY cards/overrides ./cards/overrides
COPY public ./public
COPY src ./src
RUN node tools/fetch-data.mjs --no-engine-build
# Declared here, after npm ci and the data, so a new sha does not invalidate those layers.
ARG BUILD_SHA=
# build.txt holds the build id the bundle carries, so a deploy can check what a server is running.
RUN npm run build \
 && grep -rhoE "${BUILD_SHA:-nogit}-[0-9]{8}T[0-9]{4}" dist/assets | head -1 > dist/build.txt \
 && test -s dist/build.txt

FROM node:26-alpine
ARG BUILD_SHA=
ARG SOURCE_URL=
LABEL org.opencontainers.image.title="Mars Ledger" \
      org.opencontainers.image.description="Unofficial fan-made table companion for the Terraforming Mars board game" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="$SOURCE_URL" \
      org.opencontainers.image.revision="$BUILD_SHA"
ENV BUILD_SHA=$BUILD_SHA NODE_ENV=production PORT=8080 DATA_DIR=/data CLIENT_DIST=/app/dist
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server/index.js ./server.js
# End-of-game posters: fonts, painting and portrait JPEGs, and the resvg WebAssembly module the bundle loads.
COPY server-assets ./server-assets
COPY --from=build /app/node_modules/@resvg/resvg-wasm/index_bg.wasm ./server-assets/resvg.wasm
COPY LICENSE THIRD_PARTY.md ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
# /api/health?app=1 checks the app only: an engine outage must not mark this container unhealthy (GET /api/health
# without it also asks the engine, for outside monitors).
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- "http://127.0.0.1:8080/api/health?app=1" >/dev/null || exit 1
CMD ["node", "server.js"]
