#!/usr/bin/env bash
# Runs a command inside the Playwright image (browsers + system libraries)
# extended with Bun, on the host network, so nothing browser-related is
# needed on the host.
#   hack/playwright.sh bun --bun x playwright test
#   hack/playwright.sh bun screenshots.ts http://127.0.0.1:8092 /out
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(bun -e "console.log(require('$root/e2e/node_modules/@playwright/test/package.json').version)")"
image="vm-operator-console-playwright:${version}"
if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build -q -t "$image" --build-arg PLAYWRIGHT_VERSION="$version" -f "$root/hack/playwright.Dockerfile" "$root/hack" >/dev/null
fi
out="${PW_OUT:-/tmp/opencode/shots}"
mkdir -p "$out"
exec docker run --rm --network host --ipc host \
  -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE_URL="${BASE_URL:-http://127.0.0.1:8091}" \
  -v "$root:/work" -v "$out:/out" -w /work/e2e \
  "$image" "$@"
