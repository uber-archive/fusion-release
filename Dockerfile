FROM node:8.9.4@sha256:6054aa20c5b7d198524d9bd56c7b2d4fde046b6825e8261ccbf441444a5f4d39

WORKDIR /fusion-release

RUN apt install docker-compose

COPY . .

RUN yarn

RUN node index.js
