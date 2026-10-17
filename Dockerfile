# ============================================================================
# NEPHRODESK AI PRO — PRODUCTION CONTAINER IMAGE (Multi-Stage, Non-Root)
# ============================================================================
FROM node:18-alpine AS base
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY openapi.yaml ./

# Run automated verification suite during image build
COPY tests ./tests
RUN node --test tests/run_all_tests.js

# Drop root privileges
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/v1/health || exit 1

CMD ["node", "src/server/index.js"]
