# syntax=docker/dockerfile:1.7
# secureclaw/file-read — minimal Alpine + Node.js file reader
# /workspace volume must be mounted read-only by the caller.
FROM node:22-alpine

RUN mkdir -p /tool /workspace
COPY docker/tools/file-read/run.js /tool/run.js

USER nobody

CMD ["node", "/tool/run.js"]
