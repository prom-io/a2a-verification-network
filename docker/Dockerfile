# syntax=docker/dockerfile:1

# ---------- deps: production node_modules only ----------
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* .npmrc* ./
RUN npm ci --omit=dev --ignore-scripts

# ---------- builder: full deps, compiled output ----------
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* .npmrc* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine AS runtime

# tini reaps zombies and forwards SIGTERM, which node as PID 1 does not do.
# Without it graceful shutdown never fires and a verdict that is waiting on
# finality is cut off mid-publication.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3002

WORKDIR /app

# Production dependencies come from `deps`, never from `builder`: shipping the
# build toolchain roughly triples the image and widens the CVE surface for code
# that never runs in production.
COPY --from=deps    --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist         ./dist
COPY --from=builder --chown=node:node /app/package.json ./

# Pinned contract addresses; deployments.config.ts reads them from the working
# directory when the environment does not override an address.
COPY --chown=node:node deployments ./deployments

# npm and corepack are not needed at runtime: the service starts through node
# directly. Removing them also removes the node-tar copy bundled with npm in the
# base image, which is what image scanners flag even though the application
# does not depend on it.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

USER node

EXPOSE 3002

# /health/ready answers 200 either way and reports the database probe in the
# body, so the check reads `ready` rather than the status code.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3002/health/ready',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>process.exit(r.statusCode===200&&JSON.parse(b).ready?0:1))}).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
