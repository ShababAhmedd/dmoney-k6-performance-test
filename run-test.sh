#!/usr/bin/env bash
# Runs the DMoney transaction load test and writes every report to ./reports
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f data/users.json ]; then
  echo "data/users.json not found - creating test users first"
  node scripts/create-users.mjs
fi

mkdir -p reports
K6_WEB_DASHBOARD=true \
K6_WEB_DASHBOARD_EXPORT=reports/dashboard.html \
K6_WEB_DASHBOARD_OPEN=false \
  k6 run "$@" dmoney-transactions.test.js
