# syntax=docker/dockerfile:1.7
# Multi-stage build: one statically compiled Bun binary + the built SPA on a
# distroless, non-root base image.

ARG BUN_VERSION=1.3.14

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS build
WORKDIR /src
ENV CI=true
# Install dependencies first for better layer caching.
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
ARG VERSION=dev
ARG TARGETARCH
RUN cd apps/web && bunx --bun vite build
RUN case "${TARGETARCH:-amd64}" in arm64) T=bun-linux-arm64 ;; *) T=bun-linux-x64 ;; esac && \
    cd apps/server && bun build src/index.ts --compile --minify --sourcemap --target=$T --outfile /out/vm-operator-console
RUN mkdir -p /out/public && cp -r apps/web/dist/. /out/public/

FROM gcr.io/distroless/cc-debian12:nonroot
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="vm-operator-console" \
      org.opencontainers.image.description="Web console for the Nutanix vm-operator" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="Apache-2.0"
WORKDIR /app
COPY --from=build --chown=65532:65532 /out/ /app/
ENV PORT=8080 \
    APP_VERSION=${VERSION} \
    STATIC_DIR=/app/public \
    NODE_ENV=production
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/app/vm-operator-console"]
