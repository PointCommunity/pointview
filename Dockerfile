# syntax=docker/dockerfile:1.7
FROM --platform=${TARGETPLATFORM} node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build

WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY packages/launch-sdk/package.json packages/launch-sdk/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force

FROM --platform=${TARGETPLATFORM} node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime

ARG POINTVIEW_SOURCE_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/PointCommunity/pointview" \
      org.opencontainers.image.revision="${POINTVIEW_SOURCE_REVISION}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && groupadd --gid 10001 pointview \
  && useradd --uid 10001 --gid pointview --no-create-home --home-dir /tmp pointview \
  && mkdir -p /app /var/lib/pointview/attachments \
  && chown -R pointview:pointview /app /var/lib/pointview /tmp

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache

COPY --from=build --chown=pointview:pointview /workspace/.next/standalone ./
COPY --from=build --chown=pointview:pointview /workspace/.next/static ./.next/static
COPY --from=build --chown=pointview:pointview /workspace/node_modules ./node_modules
COPY --from=build --chown=pointview:pointview /workspace/package.json /workspace/package-lock.json /workspace/tsconfig.json ./
COPY --from=build --chown=pointview:pointview /workspace/src ./src
COPY --from=build --chown=pointview:pointview /workspace/migrations ./migrations
COPY --from=build --chown=pointview:pointview /workspace/packages ./packages
COPY --from=build --chown=pointview:pointview /workspace/scripts/container-entrypoint.sh ./scripts/container-entrypoint.sh

USER 10001:10001
EXPOSE 3000
VOLUME ["/var/lib/pointview/attachments"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/app/scripts/container-entrypoint.sh"]
CMD ["web"]
