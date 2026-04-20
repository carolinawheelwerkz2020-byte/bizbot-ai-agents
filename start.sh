#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Aegis Command Center..."
export VITE_AUTH_DISABLED=true
export AUTH_DISABLED=true
export NODE_ENV=production
npx tsx server.ts
