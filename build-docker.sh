#!/bin/sh

docker build -t finp2p-ethereum-adapter:latest -f Dockerfile .
docker tag finp2p-ethereum-adapter:latest localhost:5000/finp2p-ethereum-adapter:latest
docker push localhost:5000/finp2p-ethereum-adapter:latest

