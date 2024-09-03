FROM node:18-alpine AS base
WORKDIR /usr/app

# ------------------------
FROM base AS prebuild

COPY finp2p-contracts ./finp2p-contracts
WORKDIR /usr/app/finp2p-contract
RUN npm install
RUN npm run compile

# ------------------------
FROM base AS builder

COPY \
    .eslintrc.json \
    package.json \
    babel.config.js \
    tsconfig.json \
    jest.config.js \
    ./
COPY src ./src

COPY --from=prebuild \
    finp2p-contracts/package.json \
    finp2p-contracts/package-lock.json \
    finp2p-contracts/tsconfig.json \
    ./finp2p-contracts/
COPY --from=prebuild finp2p-contracts/src ./finp2p-contracts/src
COPY --from=prebuild finp2p-contracts/artifacts ./finp2p-contracts/artifacts
COPY --from=prebuild finp2p-contracts/typechain-types ./finp2p-contracts/typechain-types

WORKDIR /usr/app
RUN npm install --omit=dev
RUN npm install --save typescript
RUN npm install --save-dev ts-node
RUN npm install --save-dev @types/node
RUN npm run build

# ------- Release ----------
FROM base as release
LABEL org.opencontainers.image.source=https://github.com/owneraio/finp2p-ethereum-adapter
ENV NODE_ENV=production

COPY --from=builder /usr/app/node_modules ./node_modules
COPY --from=builder /usr/app/dist ./dist
COPY --from=builder /usr/app/package.json ./

CMD [ "node", "/usr/app/dist/src/index.js" ]