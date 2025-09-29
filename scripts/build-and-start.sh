#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "[cc-gw] Building backend..."
pnpm --filter @cc-gw/server build

echo "[cc-gw] Building frontend..."
pnpm --filter @cc-gw/web build

echo "[cc-gw] Building CLI..."
pnpm --filter @cc-gw/cli build

echo "[cc-gw] Stopping existing gateway (if running)..."
pnpm --filter @cc-gw/cli exec node dist/index.js stop || true

echo "[cc-gw] Starting gateway..."
pnpm --filter @cc-gw/cli exec node dist/index.js start --foreground "$@"
