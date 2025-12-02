#!/bin/sh

set -eu

docker build -t finp2p-ethereum-adapter:latest \
  --secret id=npm_token,env=GITHUB_TOKEN \
  --no-cache  --progress=plain -f Dockerfile .
docker tag finp2p-ethereum-adapter:latest localhost:5000/finp2p-ethereum-adapter:latest
docker push localhost:5000/finp2p-ethereum-adapter:latest
