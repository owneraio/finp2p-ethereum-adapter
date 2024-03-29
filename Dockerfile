FROM node:18-alpine AS base
WORKDIR /usr/app

# ---- Dependencies ----
FROM base AS builder

COPY \
    .eslintrc.json \
    package.json \
    babel.config.js \
    tsconfig.json \
    jest.config.js \
    ./

COPY src ./src
COPY finp2p-contracts ./finp2p-contracts

RUN cd ./finp2p-contracts && npm install
RUN cd ./finp2p-contracts && npm run compile
RUN cd ./finp2p-contracts && npm run test
RUN npm install
RUN npm run build
RUN npm run test

# ------- Release ----------
FROM base as release
LABEL org.opencontainers.image.source=https://github.com/owneraio/finp2p-ethereum-adapter

COPY --from=builder /usr/app/node_modules ./node_modules
COPY --from=builder /usr/app/dist ./dist
COPY --from=builder /usr/app/package.json ./

CMD [ "node", "/usr/app/dist/src/index.js" ]