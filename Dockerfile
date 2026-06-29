# Dockerfile
# Production image for the WhatsApp AI Bot.
# Uses Node 22 LTS and installs Chromium dependencies required by Puppeteer/whatsapp-web.js.

FROM node:22-bullseye-slim

# Install Chromium and required system libraries for Puppeteer.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system-installed Chromium instead of downloading its own.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Persisted volumes for WhatsApp session and logs
RUN mkdir -p session logs

EXPOSE 3000

CMD ["node", "server.js"]
