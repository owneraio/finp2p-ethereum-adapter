#!/bin/sh

DOCKER_BUILDKIT=1  docker build -t finp2p-ethereum-adapter:latest --build-arg GITHUB_TOKEN=${GITHUB_TOKEN} --no-cache  --progress=plain -f Dockerfile .
docker tag finp2p-ethereum-adapter:latest localhost:5000/finp2p-ethereum-adapter:latest
docker push localhost:5000/finp2p-ethereum-adapter:latest

