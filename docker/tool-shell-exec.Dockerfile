# syntax=docker/dockerfile:1.7
# tessera/shell-exec — minimal Alpine + bash tool runner
# Container is started as nobody:nogroup (65534:65534) by sandbox-runtime.
FROM node:22-alpine

# Install bash (sh is sufficient, but bash gives better command compat)
RUN apk add --no-cache bash curl

# Create the /tool directory and copy the runner
RUN mkdir -p /tool
COPY docker/tools/shell-exec/run.js /tool/run.js

# /workspace will be mounted by the sandbox-runtime as a Docker volume
# /tmp is a tmpfs (writable) mounted by container-config.ts

# Run as nobody — sandbox-runtime overrides User at container creation
USER nobody

CMD ["node", "/tool/run.js"]
