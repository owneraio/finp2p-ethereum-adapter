#!/bin/bash

docker build -t finp2p-contracts:latest -f Dockerfile-migration .
docker tag finp2p-contracts:latest localhost:5000/finp2p-contracts:latest
docker push localhost:5000/finp2p-contracts:latest
