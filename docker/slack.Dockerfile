# syntax=docker/dockerfile:1.7
# SecureClaw Slack Channel — multi-stage build, non-root UID 10001
# Outbound-only adapter using Socket Mode (no EXPOSE, no data volume)
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/channels/slack/package.json packages/channels/slack/
RUN pnpm install --frozen-lockfile --filter @secureclaw/channel-slack

FROM deps AS build
COPY packages/channels/slack/ packages/channels/slack/
COPY tsconfig.base.json ./
RUN pnpm --filter @secureclaw/channel-slack build

FROM node:22-alpine AS runtime
WORKDIR /app

RUN addgroup -g 10001 secureclaw && \
    adduser -u 10001 -G secureclaw -s /bin/sh -D secureclaw

COPY --from=build --chown=10001:10001 /app/packages/channels/slack/dist/ packages/channels/slack/dist/
COPY --from=build --chown=10001:10001 /app/packages/channels/slack/package.json packages/channels/slack/
COPY --from=deps --chown=10001:10001 /app/node_modules/ node_modules/
COPY --from=deps --chown=10001:10001 /app/packages/channels/slack/node_modules/ packages/channels/slack/node_modules/ 2>/dev/null || true

USER 10001:10001

ENV NODE_ENV=production

CMD ["node", "packages/channels/slack/dist/index.js"]
