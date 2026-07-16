# ---- Compile goose (migration tool) ----
FROM golang:1.26.5-alpine AS migrator

RUN apk update && apk add make gcc git build-base
RUN go install github.com/pressly/goose/v3/cmd/goose@v3.27.2

# ---- Build finp2p-contracts (local dependency) ----
FROM node:20-slim AS contracts-builder
WORKDIR /usr/app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY finp2p-contracts/package.json finp2p-contracts/package-lock.json finp2p-contracts/.npmrc ./
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" && \
    echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" >> .npmrc && \
    npm ci && \
    rm .npmrc

COPY finp2p-contracts/ .
RUN npm run compile && npm run build

# --- Base image -----
FROM node:20-alpine AS base

WORKDIR /usr/app

# ------- Build --------
FROM base AS build

COPY \
    .eslintrc.json \
    package.json \
    package-lock.json \
    tsconfig.json \
    jest.config.js \
    ./
COPY src ./src
COPY --from=contracts-builder /usr/app/package.json ./finp2p-contracts/package.json
COPY --from=contracts-builder /usr/app/dist ./finp2p-contracts/dist

RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" && \
    echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" > .npmrc && \
    echo "@owneraio:registry=https://npm.pkg.github.com" >> .npmrc && \
    echo "legacy-peer-deps=true" >> .npmrc && \
    npm clean-install --ignore-scripts && \
    rm .npmrc
RUN npm run build

# ------- Production dependencies --------
FROM base AS dependencies
COPY --from=build /usr/app/package.json /usr/app/package-lock.json .
COPY --from=contracts-builder /usr/app/package.json ./finp2p-contracts/package.json
COPY --from=contracts-builder /usr/app/dist ./finp2p-contracts/dist
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" && \
    echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" > .npmrc && \
    echo "@owneraio:registry=https://npm.pkg.github.com" >> .npmrc && \
    echo "legacy-peer-deps=true" >> .npmrc && \
    npm clean-install --production --ignore-scripts && \
    rm .npmrc

# ------- Release ----------
FROM base AS release
LABEL org.opencontainers.image.source=https://github.com/owneraio/finp2p-ethereum-adapter
ENV NODE_ENV=production

# The runtime invokes `node` directly (see CMD), never `npm`/`npx`. The base
# image's globally-bundled npm ships its own copy of `tar`, which carries
# CVE-2026-59873 (node-tar DoS) and is the only CRITICAL the image scan finds.
# Remove the global npm/npx (and yarn/corepack) so that dead build-time tooling
# is not in the shipped image or its attack surface.
RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=dependencies /usr/app/node_modules ./node_modules
COPY --from=build /usr/app/dist ./dist
COPY --from=migrator /go/bin/goose /usr/bin/goose

CMD [ "node", "/usr/app/dist/index.js" ]
