#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Starting PortOpt v2 dev servers..."

# Next.js dev server
pnpm --filter @portopt/web dev &
NEXT_PID=$!

# Python data service
cd "$ROOT/apps/data-service"
uvicorn main:app --reload --port 8000 &
DATA_PID=$!
cd "$ROOT"

echo "  Next.js  → http://localhost:3000  (PID $NEXT_PID)"
echo "  Data API → http://localhost:8000  (PID $DATA_PID)"

trap "kill $NEXT_PID $DATA_PID 2>/dev/null; exit" INT TERM

wait $NEXT_PID $DATA_PID
