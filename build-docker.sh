#!/bin/sh

docker build -t node_eth_adapter:latest -f Dockerfile .
docker tag node_eth_adapter:latest localhost:5000/node_eth_adapter:latest
docker push localhost:5000/node_eth_adapter:latest

docker build -t hardhat:latest -f Dockerfile-hardhat .
docker tag hardhat:latest localhost:5000/hardhat:latest
docker push localhost:5000/hardhat:latest

