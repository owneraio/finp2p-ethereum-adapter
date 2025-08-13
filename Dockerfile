FROM node:18-alpine AS base
WORKDIR /usr/app

# ------------------------
FROM base AS prebuild

COPY finp2p-contracts ./finp2p-contracts
WORKDIR /usr/app/finp2p-contracts
RUN npm clean-install
RUN npm run compile

# ------------------------
FROM base AS builder

COPY \
    .eslintrc.json \
    package.json \
    tsconfig.json \
    jest.config.js \
    ./
COPY src ./src

COPY --from=prebuild \
    /usr/app/finp2p-contracts/package.json \
    /usr/app/finp2p-contracts/package-lock.json \
    /usr/app/finp2p-contracts/tsconfig.json \
    ./finp2p-contracts/
COPY --from=prebuild /usr/app/finp2p-contracts/src ./finp2p-contracts/src
COPY --from=prebuild /usr/app/finp2p-contracts/artifacts ./finp2p-contracts/artifacts
COPY --from=prebuild /usr/app/finp2p-contracts/typechain-types ./finp2p-contracts/typechain-types

RUN npm install --only=prod
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

CMD [ "node", "/usr/app/dist/src/index.js" ]
