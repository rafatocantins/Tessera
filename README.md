# SecureClaw

**Your secure personal AI agent. Defense in depth. Zero trust by default.**

SecureClaw is a production-ready, self-hosted AI agent platform built around the principle that security cannot be bolted on later. Every tool call is sandboxed, every credential stays in a vault, every decision is audited, and the agent can never be jailbroken into acting outside your explicitly defined policy.

---

## Why SecureClaw?

| Concern | How SecureClaw addresses it |
|---|---|
| Tool calls run arbitrary code | Every tool runs in a gVisor container — isolated from host and from each other |
| LLMs see your secrets | Credentials never leave the vault; the LLM only sees opaque `__VAULT_REF:id__` placeholders |
| Prompt injection via tool output | Session delimiters + heuristic scanner on every user message |
| Unbounded API spend | Per-user daily cost caps enforced at two layers: gateway and agent runtime |
| Rogue tool approvals | High-risk tools pause and require explicit human approval before execution |
| Audit gaps | Append-only SQLite log; triggers block UPDATE/DELETE at the database level |
| Untrusted skill bundles | Ed25519-signed manifests with pinned image digests; signature verified on every install |
| No compliance evidence | EU AI Act dashboard exports audit-derived evidence for Articles 9, 12, 14, 15 |

---

## Architecture

```
  User / Client
      │  HTTPS/WSS
      ▼
┌─────────────┐   gRPC   ┌──────────────────┐
│   Gateway   │─────────▶│  Agent Runtime   │
│  :18789     │          │  :19001          │
│             │          │  LLM loop        │
│  Auth       │          │  Policy engine   │
│  Rate limit │          │  Approval gate   │
│  CORS       │          │  OTel tracing    │
└─────────────┘          └──────┬───────────┘
                                │ gRPC
          ┌─────────────────────┼──────────────────────┐
          │                     │                      │
          ▼                     ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Credential Vault │  │  Audit System    │  │ Sandbox Runtime  │
│ :19002           │  │  :19003          │  │ :19004           │
│ OS keychain /    │  │  Append-only     │  │ gVisor (runsc)   │
│ AES-256-GCM file │  │  SQLite, costs,  │  │ per-tool containers│
└──────────────────┘  │  compliance      │  └──────────────────┘
                      └──────────────────┘          ▲
                                                    │ gRPC
                      ┌──────────────────┐  ┌──────────────────┐
                      │  Memory Store    │  │  Skills Engine   │
                      │  :19006          │  │  :19005          │
                      │  SQLite + FTS5   │  │  Ed25519 verify  │
                      │  Conversation    │  │  Signed bundles  │
                      │  history         │  │  Marketplace     │
                      └──────────────────┘  └──────────────────┘
```

All internal communication uses gRPC with optional mTLS. The gateway is the only service exposed to the network — bound to `127.0.0.1` by default.

---

## Quick Start

### Prerequisites

- **Node.js ≥ 22.13** (required for built-in `node:sqlite`)
- **pnpm ≥ 9** — `npm install -g pnpm`
- **Docker with Compose plugin** — only needed for tool sandboxing and production stack
- (Optional) [gVisor](https://gvisor.dev/docs/user_guide/install/) for full sandbox isolation

### 1. Clone and install

```bash
git clone https://github.com/rafatocantins/secureclaw.git
cd secureclaw
pnpm install
pnpm build
```

### 2. Set up secrets

```bash
secureclaw init
```

This interactive wizard generates cryptographically secure `GATEWAY_HMAC_SECRET` and `VAULT_MASTER_KEY`, prompts for your Anthropic API key (optional — press Enter to skip for Ollama), and writes a `.env` file with mode `0600`. Run it once per install.

### 3. Start

```bash
pnpm dev
```

All 8 services + the Control UI start in parallel with colour-coded output. Any service crash is immediately visible and labelled. The gateway prints a dev token at startup.

### 4. Verify

```bash
curl http://127.0.0.1:18789/health
# → {"status":"ok"}
```

### 5. Connect

```bash
# Generate a bearer token
node packages/cli/dist/bin.js token generate --user dev-user

# Open the Control UI
open http://127.0.0.1:5173

# Or open the webchat client directly
open packages/channel-webchat/src/static/client.html
```

---

## Services

| Service | Port | Description |
|---|---|---|
| **gateway** | `18789` | HTTP/WebSocket API gateway. Auth, rate limiting, CORS. |
| **agent-runtime** | `19001` | LLM loop, tool policy, approval gate, OTel tracing. |
| **credential-vault** | `19002` | OS keychain (keytar) or AES-256-GCM file fallback. |
| **audit-system** | `19003` | Append-only audit log, cost tracking, EU AI Act compliance. |
| **sandbox-runtime** | `19004` | gVisor container execution for all tool calls. |
| **skills-engine** | `19005` | Versioned, Ed25519-signed tool bundle registry and marketplace. |
| **memory-store** | `19006` | Persistent conversation history with SQLite + FTS5 search. |
| **control-ui** | `5173` | React dashboard (Vite). Approvals, audit, compliance, costs, marketplace. |

---

## Configuration

All configuration is via environment variables. Run `secureclaw init` to generate a `.env` file automatically. See [`.env.example`](.env.example) for the full reference.

All services load `.env` from the working directory at startup — no manual `export` needed.

### Required

| Variable | Description |
|---|---|
| `GATEWAY_HMAC_SECRET` | Secret for signing auth tokens. 64 hex chars (generated by `secureclaw init`). |
| `VAULT_MASTER_KEY` | AES-256-GCM key for the encrypted-file vault fallback. 64 hex chars. |
| `ANTHROPIC_API_KEY` | Anthropic API key. Or set `OLLAMA_BASE_URL` for local models. |

### Key optional settings

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | LLM model to use. |
| `GATEWAY_HOST` | `127.0.0.1` | Bind address. Never change to `0.0.0.0` without a reverse proxy. |
| `GATEWAY_PORT` | `18789` | Gateway listen port. |
| `SECURECLAW_ALLOW_RUNC` | `false` | Dev escape hatch — disables gVisor check. **Never use in production.** |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | OTLP endpoint for distributed tracing (Jaeger, Grafana Tempo, etc.). |
| `AUDIT_COST_CAP_USD` | `5.0` | Daily per-user spend cap in USD. |

---

## Security Model

### Tool Execution
Every tool call, without exception, runs inside a gVisor (`runsc`) container:
- Separate kernel from the host
- Read-only filesystem by default
- No network unless explicitly allowed
- Hard CPU, memory, and PID limits
- Time-limited (configurable per tool)

### Credentials
- Secrets are stored in the OS native keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager) or fall back to an AES-256-GCM encrypted file on headless Linux/WSL/CI
- The LLM **never** sees a credential value — only a `__VAULT_REF:ref_id__` placeholder
- The vault injects the real value into the sandboxed tool's input at execution time

### Human Approval
High-risk tools (`shell_exec`, `file_write`, `http_request` by default) pause before execution and emit a `tool_pending` event. The agent loop blocks until the user approves or denies via the Control UI or the gateway's `/approve` endpoint.

### Prompt Injection Defense
- Cryptographically random session delimiters wrap all system context
- Input heuristic scanner detects role-switch, instruction-override, and exfiltration patterns
- `CRITICAL` severity injections are blocked before reaching the LLM

### Cost Caps
Daily spend limits are enforced at two independent layers:
1. **Gateway**: checks cost summary before forwarding any message
2. **Agent Runtime**: checks before starting the LLM loop; records cost after each session

### Skill Signing
Skill bundles (third-party tools) must be signed with an Ed25519 key:
- Manifest signature verified on install and on every load from disk
- All tool images must have pinned `sha256:` digest — no floating tags
- Optional trust-key-set enforcement: only keys you've explicitly trusted can install skills

### Observability
When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, agent-runtime exports OpenTelemetry traces covering the full session hierarchy:
```
agent.session → gen_ai.chat → gen_ai.usage.*
             → secureclaw.tool.run → secureclaw.tool.*
             → secureclaw.approval.wait → secureclaw.approval.*
```
Zero overhead when the endpoint is unset (NoopTracerProvider).

---

## CLI

```bash
# Install globally
npm install -g @secureclaw/cli

# Or run directly from the monorepo
node packages/cli/dist/bin.js <command>
```

### Commands

```bash
secureclaw init                                    # First-run wizard: generate secrets, write .env
secureclaw token generate --user <userId>          # Generate a bearer token
secureclaw health [--url <url>]                    # Check gateway health
secureclaw session create [--provider anthropic]   # Start an agent session
secureclaw session status <sessionId>              # Get session status
secureclaw session delete <sessionId>              # Terminate a session
secureclaw skill list     [--search <q>]           # Browse the marketplace
secureclaw skill publish  <manifest.json> [--trivy] # Publish a skill
secureclaw skill install  <ns/name[@ver]>          # Install from marketplace
secureclaw skill installed                         # List installed skills
```

---

## Skills (Signed Tool Bundles)

Skills are versioned, signed packages that extend the agent with new tools.

### Creating a skill

```typescript
import {
  generateEd25519KeyPair,
  canonicalSkillPayload,
  signEd25519,
  SkillManifestSchema,
} from "@secureclaw/shared";

// 1. Generate a key pair (once per author — store private key securely)
const { publicKey, privateKey } = generateEd25519KeyPair();

// 2. Write your manifest
const manifest = {
  id: "your-namespace/my-skill",
  name: "My Skill",
  version: "1.0.0",
  description: "Does something useful",
  author: { name: "Your Name", email: "you@example.com" },
  published_at: new Date().toISOString(),
  public_key: publicKey,
  signature: "a".repeat(128), // placeholder — replaced below
  tools: [{
    tool_id: "my_tool",
    description: "Runs my tool in a sandbox",
    image: {
      repository: "docker.io/yourname/my-tool",
      tag: "v1.0.0",
      digest: "sha256:<64 hex chars>",  // pin the digest!
    },
    input_schema: { type: "object", properties: { input: { type: "string" } } },
    requires_approval: false,
    resource_limits: {},
  }],
  permissions: {},
  tags: [],
};

// 3. Sign (must Zod-parse before computing canonical payload)
const parsed = SkillManifestSchema.parse(manifest);
const canonical = canonicalSkillPayload(parsed);
const signature = signEd25519(privateKey, canonical);
const signed = JSON.stringify({ ...parsed, signature });

// 4. Publish to marketplace
secureclaw skill publish manifest.json --trivy
```

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests (228 passing)
pnpm test

# Type-check all packages
pnpm typecheck

# First-run setup (generates .env)
secureclaw init

# Start all services + Control UI
pnpm dev

# Backend only (no Vite UI)
pnpm dev:services

# Generate mTLS certificates (if using GRPC_TLS=true)
bash scripts/gen-certs.sh
```

### Project structure

```
secureclaw/
├── packages/
│   ├── shared/            # Schemas, crypto utils, gRPC types, proto files, loadDotenv
│   ├── gateway/           # Fastify HTTP/WebSocket gateway
│   ├── agent-runtime/     # LLM loop, policy engine, approval gate, OTel spans
│   ├── credential-vault/  # OS keychain + AES-256-GCM file fallback
│   ├── audit-system/      # Append-only event log, cost tracking, EU AI Act compliance
│   ├── sandbox-runtime/   # gVisor container manager
│   ├── skills-engine/     # Signed skill bundle registry, executor, marketplace
│   ├── input-sanitizer/   # Injection detection and PII redaction
│   ├── memory-store/      # Persistent conversation memory (SQLite + FTS5)
│   ├── cli/               # `secureclaw` CLI (init, token, session, skill, health)
│   └── channels/
│       └── webchat/       # Browser WebSocket test client
├── apps/
│   └── control-ui/        # React dashboard (Vite) — 7 tabs
├── docker/                # Dockerfiles for each service
├── scripts/               # gen-certs.sh
├── .github/workflows/
│   ├── ci.yml             # Secret scan, typecheck, tests, Trivy, integration
│   └── cross-platform.yml # OS × Node matrix (ubuntu/windows/macos × 20/22)
├── docker-compose.yml     # Production stack
├── docker-compose.dev.yml # Development overrides + optional Jaeger tracing
└── .env.example           # All environment variables documented
```

---

## CI/CD

GitHub Actions runs on every push to `main`/`develop` and on PRs:

**`ci.yml`** — full quality gate:
1. **Secret scan** — blocks `.env` files and hardcoded API keys (gitleaks)
2. **Quality** — typecheck + lint for every package
3. **Tests** — unit tests with coverage upload (codecov)
4. **Dependency audit** — `pnpm audit --audit-level=high`
5. **Docker build + Trivy scan** — CRITICAL/HIGH vulnerability scan for each service image
6. **Full build** — `pnpm -r build` across the entire monorepo
7. **Integration tests** — full Docker Compose stack with mock LLM
8. **Compose validate** — syntax-checks docker-compose.yml

**`cross-platform.yml`** — platform compatibility matrix:

| | Node 20 | Node 22 |
|---|---|---|
| ubuntu-latest | build | build + test |
| windows-latest | build | build + test |
| macos-latest | build | build + test |

Node 20 is build-only because `node:sqlite` (built-in SQLite) requires Node 22.13+.

---

## Roadmap

- [x] Core agent loop, gRPC services, mTLS, cost caps, audit log
- [x] Skills engine (Ed25519-signed tool bundles, per-skill sandboxing)
- [x] Persistent conversation memory (SQLite + FTS5 semantic search)
- [x] Control UI (dashboard, audit viewer, approval queue, 7 tabs)
- [x] EU AI Act compliance dashboard (Articles 9, 12, 14, 15)
- [x] Cost showback / chargeback (team attribution, CSV export)
- [x] Skills marketplace (publish, list, install, Trivy scan, download counts)
- [x] OpenTelemetry tracing (agent.session → gen_ai.chat → tool.run → approval.wait)
- [x] Dual-backend credential vault (OS keychain + AES-256-GCM file fallback)
- [x] Single-command dev start (`pnpm dev` via concurrently)
- [x] First-run setup wizard (`secureclaw init`)
- [x] Cross-platform CI matrix (Windows × macOS × Linux × Node 20/22)
- [ ] Configurable token expiry + refresh endpoint
- [ ] Hard per-team spending quotas + webhook alerting
- [ ] Vault key rotation CLI command
- [ ] RBAC / SSO / OIDC
- [ ] Kubernetes deployment manifests

---

## License

MIT — see [LICENSE](LICENSE).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
