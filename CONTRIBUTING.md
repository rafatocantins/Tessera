# Contributing to SecureClaw

Thank you for your interest in contributing. This document explains how the project is organised, how to get your environment running, and what to expect during code review.

---

## Table of Contents

1. [Project structure](#1-project-structure)
2. [Development setup](#2-development-setup)
3. [Running tests](#3-running-tests)
4. [Code style](#4-code-style)
5. [How to add a new Skill (signed tool bundle)](#5-how-to-add-a-new-skill)
6. [How to add a new messaging channel](#6-how-to-add-a-new-messaging-channel)
7. [Pull-request process](#7-pull-request-process)
8. [Security disclosures](#8-security-disclosures)

---

## 1. Project structure

```
secureclaw/
├── packages/
│   ├── shared/            # Zod schemas, crypto utils, gRPC proto files & loader, shared types
│   ├── gateway/           # Fastify HTTP/WebSocket gateway (public-facing)
│   ├── agent-runtime/     # LLM loop, policy engine, approval gate, gRPC server
│   ├── credential-vault/  # Secret storage (OS keychain) + vault-ref injection
│   ├── audit-system/      # Append-only SQLite audit log, cost tracking, anomaly alerts
│   ├── sandbox-runtime/   # gVisor container manager for tool execution
│   ├── skills-engine/     # Ed25519-verified skill bundle registry + executor
│   ├── input-sanitizer/   # Prompt injection detection, PII redaction
│   ├── memory-store/      # (Phase 2) Persistent conversation memory
│   ├── cli/               # `secureclaw` CLI
│   └── channels/
│       └── webchat/       # Browser WebSocket test client
├── apps/
│   └── control-ui/        # (Phase 2) React dashboard
├── docker/                # Per-service Dockerfiles (multi-stage, non-root UID 10001)
├── scripts/               # Helper scripts (start-dev.sh, gen-certs.sh)
└── .github/workflows/     # CI pipeline (secret-scan → quality → test → docker → build)
```

Everything is a pnpm workspace. The single `pnpm-lock.yaml` at the root pins all dependency versions. Never commit `node_modules/` or individual `package-lock.json` files.

**Dependency rule**: packages may only import from `@secureclaw/shared`. No package may import from another service package (e.g., `gateway` must not import from `agent-runtime`). Communication is always via gRPC.

---

## 2. Development setup

### Prerequisites

| Tool | Minimum version |
|---|---|
| Node.js | 22 |
| pnpm | 9 |
| Docker + Compose plugin | any recent |
| gVisor `runsc` | optional (set `SECURECLAW_ALLOW_RUNC=true` in dev) |

### First-time setup

```bash
git clone https://github.com/your-username/secureclaw.git
cd secureclaw

# Install all workspace dependencies
pnpm install

# Copy the environment template
cp .env.example .env
# Edit .env — set at least one LLM key (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY)

# Start the full dev stack (Docker Compose with hot reload)
bash scripts/start-dev.sh
```

### Building individual packages

```bash
# Build everything (respects workspace dependency order)
pnpm -r build

# Build one package
pnpm --filter @secureclaw/shared build
pnpm --filter @secureclaw/agent-runtime build
```

### Typechecking

```bash
# Typecheck all
pnpm -r typecheck

# Typecheck one
pnpm --filter @secureclaw/gateway typecheck
```

### mTLS (optional)

If you want to test with `GRPC_TLS=true`:

```bash
bash scripts/gen-certs.sh   # writes certs/ directory
```

---

## 3. Running tests

Tests use [Vitest](https://vitest.dev/). Every package with a `test` script is included in CI.

```bash
# Run all tests across the monorepo
pnpm -r test

# Run tests for a single package (with watch mode)
pnpm --filter @secureclaw/shared test
pnpm --filter @secureclaw/skills-engine test --watch

# Run with coverage
pnpm --filter @secureclaw/audit-system test --coverage
```

### Test file conventions

- Place unit tests next to the source file: `src/foo.ts` → `src/foo.test.ts`
- Use `describe` + `it` blocks. Group related assertions under the same `describe`.
- Mock external I/O (gRPC calls, SQLite, keychain) with `vi.mock()` or in-memory stubs — tests must not require running services.
- The `packages/shared` package contains shared test fixtures (e.g., `makeTestManifest()` helpers in test files).

### Skill manifest test helpers — important caveat

When writing test helpers that sign a `SkillManifest`, you **must** call `SkillManifestSchema.parse()` before `canonicalSkillPayload()`. The verifier applies the same Zod defaults, so both sides must operate on the same normalised form:

```typescript
// CORRECT
const parsed = SkillManifestSchema.parse(rawManifest);
const canonical = canonicalSkillPayload(parsed);
const signature = signEd25519(privateKey, canonical);

// WRONG — will produce a signature that fails verification
const canonical = canonicalSkillPayload(rawManifest);  // missing Zod defaults
const signature = signEd25519(privateKey, canonical);
```

---

## 4. Code style

- **Language**: TypeScript strict mode everywhere (`"strict": true` in all `tsconfig.json` files).
- **Module format**: ESM only (`"type": "module"` in every `package.json`). Import paths must include the `.js` extension (TypeScript resolves `.ts` at build time, Node.js needs `.js` at runtime).
- **Linting**: ESLint. Run `pnpm -r lint` before opening a PR. Lint errors block CI.
- **Formatting**: Prettier is configured at the root. Run `pnpm prettier --write .` if you want auto-formatting.
- **No default exports** — named exports only.
- **Error handling**: Never swallow errors silently except in fire-and-forget audit logging (audit must not crash other services). Always propagate or log.
- **Secrets**: Never log credential values. Never pass secrets as plain strings across gRPC (use vault refs). Never hardcode keys in source files — CI will block the PR.
- **Comments**: Only where the logic is not self-evident. No JSDoc on internal functions.

---

## 5. How to add a new Skill

Skills are versioned, Ed25519-signed tool bundles that run inside gVisor containers. Adding one involves three things: the Docker image, the manifest, and (optionally) a new tool ID in the built-in registry.

### Step 1 — Build and publish the tool image

Your tool must be packaged as a Docker image that:
- Accepts input as `stdin` (JSON) or as CLI arguments, depending on your `input_schema`.
- Writes output to `stdout` (JSON or plain text).
- Exits 0 on success, non-zero on failure.
- Has a pinned `sha256:` digest — no floating tags.

```bash
docker build -t docker.io/yourname/my-tool:v1.0.0 .
docker push docker.io/yourname/my-tool:v1.0.0
# Get the digest:
docker inspect --format='{{index .RepoDigests 0}}' docker.io/yourname/my-tool:v1.0.0
# → docker.io/yourname/my-tool@sha256:<64 hex chars>
```

### Step 2 — Generate an Ed25519 key pair (once per author)

```typescript
import { generateEd25519KeyPair } from "@secureclaw/shared";

const { publicKey, privateKey } = generateEd25519KeyPair();
// publicKey and privateKey are hex-encoded DER strings
// Store privateKey in a secret manager — never commit it
```

### Step 3 — Write and sign the manifest

```typescript
import {
  SkillManifestSchema,
  canonicalSkillPayload,
  signEd25519,
} from "@secureclaw/shared";

const raw = {
  id: "yourname/my-tool",
  name: "My Tool",
  version: "1.0.0",
  description: "Does something useful",
  author: { name: "Your Name", email: "you@example.com" },
  published_at: new Date().toISOString(),
  public_key: publicKey,
  signature: "a".repeat(128),  // placeholder — overwritten below
  tools: [{
    tool_id: "my_tool",
    description: "Runs my tool in a sandbox",
    image: {
      repository: "docker.io/yourname/my-tool",
      tag: "v1.0.0",
      digest: "sha256:<64 hex chars>",
    },
    input_schema: {
      type: "object",
      properties: { input: { type: "string" } },
      required: ["input"],
    },
    requires_approval: false,
    resource_limits: {},
  }],
  permissions: {},
  tags: ["utility"],
};

// Parse first (applies Zod defaults — REQUIRED for signature correctness)
const parsed = SkillManifestSchema.parse(raw);
const canonical = canonicalSkillPayload(parsed);
const signature = signEd25519(privateKey, canonical);
const signed = JSON.stringify({ ...parsed, signature });
```

### Step 4 — Install via the gateway

```bash
TOKEN=$(secureclaw token generate --user dev)

curl -X POST http://127.0.0.1:18789/api/v1/skills \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"manifest_json\": $(jq -Rs . <<< "$signed")}"
```

### Step 5 — Test it

Send a chat message that would invoke your tool. The agent loop dynamically loads skill tools at the start of each turn — no restart needed.

### Trust enforcement

In production you can restrict which signing keys may install skills by setting `SKILLS_TRUST_KEYS` in `.env` to a comma-separated list of hex-encoded public keys. Any manifest not signed by a key in this list will be rejected at install time.

---

## 6. How to add a new messaging channel

Channels are separate packages under `packages/channels/`. Each channel connects to the gateway via WebSocket or HTTP and translates platform-specific events into SecureClaw's message protocol.

### Package setup

```bash
mkdir -p packages/channels/my-channel/src
cd packages/channels/my-channel
```

Create `package.json`:

```json
{
  "name": "@secureclaw/channel-my-channel",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "@secureclaw/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^25.0.0",
    "typescript": "^5.7.0"
  }
}
```

Add `tsconfig.json` extending the root base:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

### Gateway connection protocol

The channel connects to the gateway WebSocket at `ws://127.0.0.1:18789/ws` with a `Bearer <token>` header.

**Client → gateway messages:**

```typescript
// Start a session
{ type: "session_create", provider: "anthropic" }

// Send a message
{ type: "message", session_id: "<id>", content: "<text>" }

// Approve a pending tool call
{ type: "approve", session_id: "<id>", call_id: "<id>", approved: true }
```

**Gateway → client messages:**

```typescript
{ type: "session_created", session_id: "<id>" }
{ type: "chunk", session_id: "<id>", delta: "<text>" }
{ type: "tool_pending", session_id: "<id>", call_id: "<id>", tool_id: "<id>", requires_approval: boolean }
{ type: "tool_result", session_id: "<id>", call_id: "<id>", success: boolean }
{ type: "injection_warning", session_id: "<id>", severity: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", pattern: "<string>" }
{ type: "complete", session_id: "<id>", input_tokens: number, output_tokens: number, cost_usd: number }
{ type: "error", session_id: "<id>", message: "<string>" }
```

### Channel responsibilities

1. Authenticate with the platform (e.g., Telegram Bot API, Slack Events API).
2. Translate incoming platform messages into `{ type: "message", ... }` gateway messages.
3. Stream `chunk` events back to the platform as text.
4. Handle `tool_pending` where `requires_approval: true` — prompt the user on the platform for approval, then send the `approve` message.
5. Send `complete` or `error` as a final platform message.

### Adding the channel to CI

Add the package name to the `quality.matrix.package` list in `.github/workflows/ci.yml`.

### Adding a Dockerfile

Create `docker/channel-my-channel.Dockerfile` following the pattern of `docker/skills-engine.Dockerfile`:
- Multi-stage build (deps → build → runtime)
- Non-root UID 10001
- `read_only: true` filesystem
- TCP healthcheck on the service port

Add the service to `docker-compose.yml` on `secureclaw-net` only (no direct external exposure).

---

## 7. Pull-request process

1. **Fork and branch** — branch from `develop`, not `main`. Name branches `feat/<short-description>`, `fix/<short-description>`, or `chore/<short-description>`.

2. **Keep PRs focused** — one logical change per PR. Reviewers should be able to understand the change without context from other in-flight work.

3. **Checklist before opening the PR**:
   - [ ] `pnpm -r build` succeeds with no errors
   - [ ] `pnpm -r typecheck` passes
   - [ ] `pnpm -r lint` passes
   - [ ] `pnpm -r test` passes (or new tests added for new behaviour)
   - [ ] No `.env` files or hardcoded secrets in the diff
   - [ ] Docker images use pinned base tags (e.g., `node:22-alpine`) — no `latest`

4. **CI must be green** — all CI jobs must pass before merge. The CI runs:
   - Secret scan (gitleaks + heuristic key pattern check)
   - Typecheck + lint per package
   - Unit tests per package
   - Dependency audit (`pnpm audit --audit-level=high`)
   - Docker build + Trivy vulnerability scan (CRITICAL/HIGH, on push only)
   - Full monorepo build
   - `docker compose config` syntax validation

5. **Review** — at least one approving review from a maintainer is required. Address all review comments before merging.

6. **Commit messages** — use [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(skills-engine): add trust-key-set enforcement at install time
   fix(agent-loop): close unclosed else block in skill tool routing
   chore(ci): add skills-engine to docker build matrix
   ```

7. **Merge strategy** — squash merge to `develop`. Releases are cut by merging `develop` → `main` with a version bump commit.

---

## 8. Security disclosures

**Do not open a public GitHub issue for security vulnerabilities.**

If you discover a security issue — injection bypass, authentication flaw, credential exposure, sandbox escape — please report it privately:

1. Email the maintainers at `security@example.com` (replace with real address).
2. Or use [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) if enabled on the repository.

Include:
- A clear description of the vulnerability
- Steps to reproduce
- The potential impact
- Any suggested mitigations

We aim to acknowledge reports within 48 hours and to issue a fix or workaround within 14 days for critical issues.

---

## Questions?

Open a [GitHub Discussion](https://github.com/your-username/secureclaw/discussions) for questions about the architecture or contribution process. Use Issues only for confirmed bugs or accepted feature requests.
