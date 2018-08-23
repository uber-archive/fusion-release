FROM uber/web-base-image:1.0.8@sha256:c20637d449fa8604874e588780a6800dd05cc83028fae14c45a05186402607e5

WORKDIR /fusion-release

RUN apt-get update && \
  apt-get install -y python2.7-dev python-pip && \
  pip install docker-compose

# Install docker
RUN apt-get update && \
  apt-get -y install apt-transport-https \
  ca-certificates \
  curl \
  gnupg2 \
  software-properties-common && \
  curl -fsSL https://download.docker.com/linux/$(. /etc/os-release; echo "$ID")/gpg > /tmp/dkey; apt-key add /tmp/dkey && \
  add-apt-repository \
  "deb [arch=amd64] https://download.docker.com/linux/$(. /etc/os-release; echo "$ID") \
  $(lsb_release -cs) \
  stable" && \
  apt-get update && \
  apt-get -y install docker-ce

COPY . .

RUN yarn

RUN ./node_modules/.bin/babel-node src/index.js

