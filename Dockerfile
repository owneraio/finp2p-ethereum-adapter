FROM node:18-alpine AS base
WORKDIR /usr/app

# ---- Dependencies ----
FROM base AS builder

COPY \
    .eslintrc.json \
    package.json \
    babel.config.js \
    tsconfig.json \
    hardhat.config.ts \
    jest.config.js \
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
COPY --from=builder /usr/app/dist ./dist
COPY --from=builder /usr/app/package.json ./
RUN pwd
RUN ls -la ./dist/src

#COPY package.json .
#RUN yarn link
#ENV NODE_ENV=production

CMD [ "node", "/usr/app/dist/src/index.js" ]