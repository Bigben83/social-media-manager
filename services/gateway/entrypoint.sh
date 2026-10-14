#!/bin/sh
set -eu
expected="$(sha256sum package-lock.json | cut -d ' ' -f 1)"
actual="$(cat node_modules/.dependency-lock-hash 2>/dev/null || true)"
if [ "$expected" != "$actual" ]; then
  npm ci --omit=dev --no-fund --no-audit
  printf '%s' "$expected" > node_modules/.dependency-lock-hash
fi
exec node start.js
