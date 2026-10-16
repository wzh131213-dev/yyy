FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PAINTED_ANIMATION_TEMPLATE=/opt/painted-animation/template \
    CHROME_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ffmpeg chromium fonts-noto-cjk fonts-noto-color-emoji ca-certificates \
    python3 make g++ && rm -rf /var/lib/apt/lists/*

# Fetch the upstream skill source. Pin this ref to a reviewed commit before production.
RUN git clone --depth 1 https://github.com/Joker-chichi/claude-mv-skill.git /opt/painted-animation/upstream \
 && test -d /opt/painted-animation/upstream/skills/painted-animation/template \
 && cp -a /opt/painted-animation/upstream/skills/painted-animation/template /opt/painted-animation/template \
 && cd /opt/painted-animation/template \
 && if [ -f package.json ]; then npm install; fi

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public
RUN mkdir -p /app/workspaces
EXPOSE 8080
CMD ["npm", "start"]
