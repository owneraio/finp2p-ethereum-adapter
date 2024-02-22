FROM node:18-alpine AS base
WORKDIR /usr/app

# ---- Dependencies ----
FROM base AS builder

COPY \
    package.json \
    tsconfig.json \
    .eslintrc.json \
    hardhat.config.ts \
    ./

COPY src ./src
COPY contracts ./contracts
#COPY tests ./tests
#COPY jest.config.js ./

RUN npm install
RUN npm run contracts-compile
RUN npm run build

# ------- Release ----------
FROM base as release
LABEL org.opencontainers.image.source=https://github.com/owneraio/nodejs_ledger_adapter_skeleton

COPY --from=builder /usr/app/node_modules ./node_modules
COPY package.json .
RUN yarn link

ENV NODE_ENV=production

CMD [ "node", "/usr/app/lib/src/index.js" ]