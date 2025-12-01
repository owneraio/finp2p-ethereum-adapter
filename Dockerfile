# ---- compile goose (migration tool) ----
FROM golang:1.24.5-alpine AS migrator

RUN apk update && apk add make gcc git build-base
RUN go install github.com/pressly/goose/v3/cmd/goose@v3.26.0

# --- base image -----
FROM node:20-alpine AS base

WORKDIR /usr/app

# ------------------------
FROM base AS compile

COPY finp2p-contracts ./finp2p-contracts
WORKDIR /usr/app/finp2p-contracts
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" && \
    echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" > .npmrc && \
    echo "@owneraio:registry=https://npm.pkg.github.com" >> .npmrc && \
    npm clean-install && \
    rm .npmrc
RUN npm run compile

RUN ls ./src

# ------------------------
FROM base AS build

COPY \
    .eslintrc.json \
    package.json \
    package-lock.json \
    tsconfig.json \
    jest.config.js \
    ./
COPY src ./src

COPY --from=compile \
    /usr/app/finp2p-contracts/package.json \
    /usr/app/finp2p-contracts/package-lock.json \
    /usr/app/finp2p-contracts/tsconfig.json \
    ./finp2p-contracts/
COPY --from=compile /usr/app/finp2p-contracts/src ./finp2p-contracts/src
COPY --from=compile /usr/app/finp2p-contracts/artifacts ./finp2p-contracts/artifacts
COPY --from=compile /usr/app/finp2p-contracts/typechain-types ./finp2p-contracts/typechain-types

RUN ls -al ./finp2p-contracts/src

RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" && \
    echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" > .npmrc && \
    echo "@owneraio:registry=https://npm.pkg.github.com" >> .npmrc && \
    npm clean-install && \
    rm .npmrc
RUN npm run build

# ------- Production dependencies --------
FROM base AS dependencies
COPY --from=build /usr/app/package.json /usr/app/package-lock.json .
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" && \
    echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" > .npmrc && \
    echo "@owneraio:registry=https://npm.pkg.github.com" >> .npmrc && \
    npm clean-install --production && \
    rm .npmrc

# ------- Release ----------
FROM base AS release
LABEL org.opencontainers.image.source=https://github.com/owneraio/finp2p-ethereum-adapter
ENV NODE_ENV=production

COPY --from=dependencies /usr/app/node_modules ./node_modules
COPY --from=build /usr/app/dist ./dist
COPY --from=migrator /go/bin/goose /usr/bin/goose

CMD [ "node", "/usr/app/dist/index.js" ]
