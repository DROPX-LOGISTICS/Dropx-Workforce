FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    novnc \
    openbox \
    procps \
    websockify \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./
COPY entrypoint.sh ./
RUN chmod +x ./entrypoint.sh

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080 6080

CMD ["./entrypoint.sh"]
