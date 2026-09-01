# ---- Compile goose (migration tool) ----
FROM golang:1.26.5-alpine AS migrator

RUN apk update && apk add make gcc git build-base
# goose v3.27.3 still pins the CVE-2026-56854-affected golang.org/x/crypto,
# so build it from source with the patched dependency
RUN git clone --depth 1 --branch v3.27.3 https://github.com/pressly/goose /src/goose \
    && cd /src/goose \
    && go get golang.org/x/crypto@v0.55.0 \
    && go build -o /go/bin/goose ./cmd/goose

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
    echo "legacy-peer-deps=true" >> .npmrc && \
    npm clean-install --ignore-scripts && \
    rm .npmrc
RUN npm run build

# ------- Production dependencies --------
FROM base AS dependencies
COPY --from=build /usr/app/package.json /usr/app/package-lock.json .
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
