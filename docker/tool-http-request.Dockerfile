# syntax=docker/dockerfile:1.7
# secureclaw/http-request — minimal Alpine + Node.js fetch tool runner
# Network mode is set to "bridge" (not "none") by the caller when this tool is used.
FROM node:22-alpine

RUN mkdir -p /tool
COPY docker/tools/http-request/run.js /tool/run.js

USER nobody

CMD ["node", "/tool/run.js"]
