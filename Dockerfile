# AfriPass MVP — zero-dependency Node app, so the image stays tiny.
FROM node:20-alpine

WORKDIR /app

# No dependencies to install (zero-dependency app) — package.json is
# copied for metadata/scripts only. If you add dependencies later, add
# `RUN npm ci --omit=dev` back in here, before the full COPY, to keep
# Docker's layer cache working.
COPY package.json ./

COPY . .

# Data and uploads should live on a mounted volume in production — see
# docker-compose.yml / README for the volume mapping. Create the dirs so
# the app has somewhere to write even before a volume is attached.
RUN mkdir -p /app/data /app/uploads && \
    addgroup -S afripass && adduser -S afripass -G afripass && \
    chown -R afripass:afripass /app

USER afripass

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
