# syntax=docker/dockerfile:1.7
# secureclaw/file-write — minimal Alpine + Node.js file writer
# /workspace volume must be mounted read-write by the caller.
FROM node:22-alpine

RUN mkdir -p /tool /workspace
COPY docker/tools/file-write/run.js /tool/run.js

USER nobody

CMD ["node", "/tool/run.js"]
