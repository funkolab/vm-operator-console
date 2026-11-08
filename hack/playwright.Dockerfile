# Playwright browsers and their system libraries, with Bun as the runtime.
ARG PLAYWRIGHT_VERSION
ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION} AS bun

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
