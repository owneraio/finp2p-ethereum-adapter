# ---- Compile goose (migration tool) ----
FROM golang:1.24.5-alpine AS migrator

RUN apk update && apk add make gcc git build-base
RUN go install github.com/pressly/goose/v3/cmd/goose@v3.26.0

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
COPY migrations ./migrations
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

COPY --from=dependencies /usr/app/node_modules ./node_modules
COPY --from=build /usr/app/dist ./dist
COPY --from=build /usr/app/migrations ./migrations
COPY --from=migrator /go/bin/goose /usr/bin/goose

CMD [ "node", "/usr/app/dist/index.js" ]
