#!/usr/bin/env bash
set -e
node --test tests/run_all_tests.js
git add -A && git commit -m "Setup NephroDesk AI Pro full-stack from iPad" || true
git push origin main || true
node src/server/index.js
