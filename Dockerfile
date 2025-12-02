# ---- Compile goose (migration tool) ----
FROM golang:1.24.5-alpine AS migrator

RUN apk update && apk add make gcc git build-base
RUN go install github.com/pressly/goose/v3/cmd/goose@v3.26.0

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
