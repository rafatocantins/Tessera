# tessera/read-url — Build & Install Guide

## 1. Generate a signing key (once per publisher identity)

```bash
tessera skill keygen --name my-skill-key
# → my-skill-key.private.key  (keep secret)
# → my-skill-key.public.key   (embed in manifest)
```

## 2. Edit manifest.template.json

Copy the contents of `my-skill-key.public.key` into the `public_key` field.

## 3. Build the container image

```bash
cd skills/tessera/read-url
docker build -t ghcr.io/tessera/read-url:1.0.0 .
```

## 4. Get the image digest

```bash
docker inspect ghcr.io/tessera/read-url:1.0.0 \
  --format '{{index .Id}}'
# → sha256:<64 hex chars>
```

Update the `digest` field in `manifest.template.json` with this value.

## 5. Sign the manifest

```bash
tessera skill sign manifest.template.json \
  --private-key my-skill-key.private.key \
  --output manifest.json
```

## 6. Install locally

```bash
tessera skill install-local manifest.json
```

## 7. Verify installation

```bash
tessera skill installed
# tessera/read-url   1.0.0   1 tool   <timestamp>
```

The `read_url` tool is now available to the agent. The LLM can call it by name in chat.
