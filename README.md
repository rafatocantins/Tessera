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
│  CORS       │          └──────┬───────────┘
└─────────────┘                 │ gRPC (mTLS)
                                │
          ┌─────────────────────┼────────────────────┐
          │                     │                    │
          ▼                     ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Credential Vault │  │  Audit System    │  │ Sandbox Runtime  │
│ :19002           │  │  :19003          │  │ :19004           │
│ OS keychain      │  │  Append-only     │  │ gVisor (runsc)   │
│ Secret injection │  │  SQLite + alerts │  │ per-tool containers│
└──────────────────┘  └──────────────────┘  └──────────────────┘
                                                      ▲
                                                      │ gRPC
                                             ┌──────────────────┐
                                             │  Skills Engine   │
                                             │  :19005          │
                                             │  Ed25519 verify  │
                                             │  Signed bundles  │
                                             └──────────────────┘
```

All internal communication uses gRPC with optional mTLS. The gateway is the only service exposed to the network — bound to `127.0.0.1` by default.

---

## Quick Start

### Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9
- Docker with Compose plugin
- (Optional) [gVisor](https://gvisor.dev/docs/user_guide/install/) for full sandbox isolation

### 1. Clone and install

```bash
git clone https://github.com/your-username/secureclaw.git
cd secureclaw
pnpm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — at minimum set one LLM API key:
# ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or OLLAMA_BASE_URL
```

### 3. Start

```bash
bash scripts/start-dev.sh
```

This script checks prerequisites, generates a `GATEWAY_HMAC_SECRET` if missing, and starts all services via Docker Compose.

### 4. Verify

```bash
curl http://127.0.0.1:18789/health
# → {"status":"ok","version":"0.1.0"}
```

### 5. Connect

```bash
# Generate a token
npx secureclaw token generate --user dev

# Open the webchat client
open packages/channels/webchat/src/static/client.html
# Enter the gateway URL and token — start chatting
```

---

## Services

| Service | Port | Description |
|---|---|---|
| **gateway** | `18789` | HTTP/WebSocket API gateway. Auth, rate limiting, CORS. |
| **agent-runtime** | `19001` | LLM loop, tool policy, approval gate. |
| **credential-vault** | `19002` | OS-native secret storage with vault ref injection. |
| **audit-system** | `19003` | Append-only audit log, cost tracking, anomaly alerts. |
| **sandbox-runtime** | `19004` | gVisor container execution for all tool calls. |
| **skills-engine** | `19005` | Versioned, Ed25519-signed tool bundle management. |

---

## Configuration

All configuration is via environment variables. See [`.env.example`](.env.example) for the full reference.

### Required

| Variable | Description |
|---|---|
| `GATEWAY_HMAC_SECRET` | Secret for signing auth tokens. Min 32 chars. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | At least one LLM provider key. |

### Key optional settings

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_HOST` | `127.0.0.1` | Bind address. Never change to `0.0.0.0` without a reverse proxy. |
| `SECURECLAW_ALLOW_RUNC` | `false` | Dev escape hatch — disables gVisor check. **Never use in production.** |
| `GRPC_TLS` | `false` | Enable mTLS between services. Run `bash scripts/gen-certs.sh` first. |
| `SECURECLAW_LOG_LEVEL` | `info` | `trace` \| `debug` \| `info` \| `warn` \| `error` |

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
- Secrets are stored in the OS native keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager)
- The LLM **never** sees a credential value — only a `__VAULT_REF:ref_id__` placeholder
- The vault injects the real value into the sandboxed tool's input at execution time

### Human Approval
High-risk tools (`shell_exec`, `file_write`, `http_request` by default) pause before execution and emit a `tool_pending` event. The agent loop blocks until the user approves or denies via the gateway's `/approve` endpoint or WebSocket message.

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

---

## CLI

```bash
# Install globally
npm install -g @secureclaw/cli

# Or use via pnpm in the monorepo
pnpm --filter @secureclaw/cli exec secureclaw <command>
```

### Commands

```bash
secureclaw token generate --user <userId>     # Generate a bearer token
secureclaw session create [--provider anthropic]  # Start an agent session
secureclaw session status <sessionId>          # Get session status
secureclaw session delete <sessionId>          # Terminate a session
secureclaw health [--url <url>]                # Check gateway health
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

// 4. Install
await fetch("http://127.0.0.1:18789/api/v1/skills", {
  method: "POST",
  headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ manifest_json: signed }),
});
```

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Type-check all packages
pnpm typecheck

# Start dev stack (hot reload)
bash scripts/start-dev.sh

# Generate mTLS certificates (if using GRPC_TLS=true)
bash scripts/gen-certs.sh
```

### Project structure

```
secureclaw/
├── packages/
│   ├── shared/            # Schemas, crypto utils, gRPC types, proto files
│   ├── gateway/           # Fastify HTTP/WebSocket gateway
│   ├── agent-runtime/     # LLM loop, policy engine, approval gate
│   ├── credential-vault/  # Secret storage and vault ref injection
│   ├── audit-system/      # Append-only event log and cost tracking
│   ├── sandbox-runtime/   # gVisor container manager
│   ├── skills-engine/     # Signed skill bundle registry and executor
│   ├── input-sanitizer/   # Injection detection and PII redaction
│   ├── memory-store/      # (Phase 2) Persistent conversation memory
│   ├── cli/               # `secureclaw` CLI tool
│   └── channels/
│       └── webchat/       # Browser WebSocket test client
├── apps/
│   └── control-ui/        # (Phase 2) React dashboard
├── docker/                # Dockerfiles for each service
├── scripts/               # gen-certs.sh, start-dev.sh
├── .github/workflows/     # CI: secret scan, typecheck, tests, Trivy
├── docker-compose.yml     # Production stack
├── docker-compose.dev.yml # Development overrides
└── .env.example           # All environment variables documented
```

---

## CI/CD

GitHub Actions runs on every push to `main`/`develop` and on PRs:

1. **Secret scan** — blocks `.env` files and hardcoded API keys (gitleaks)
2. **Quality** — typecheck + lint for every package
3. **Tests** — unit tests with coverage upload (codecov)
4. **Dependency audit** — `pnpm audit --audit-level=high`
5. **Docker build + Trivy scan** — CRITICAL/HIGH vulnerability scan for each image
6. **Full build** — `pnpm -r build` across the entire monorepo
7. **Compose validate** — syntax-checks docker-compose.yml

---

## Roadmap

- [x] Phase 1: Core agent loop, gRPC services, mTLS, cost caps, audit log
- [x] Phase 2a: Skills engine (Ed25519-signed tool bundles, per-skill sandboxing)
- [ ] Phase 2b: Memory store (persistent conversation memory, semantic search)
- [ ] Phase 2c: Control UI (dashboard, audit viewer, approval queue)
- [ ] Messaging channels: Telegram, Slack, Discord, WhatsApp, Teams
- [ ] Integration test suite
- [ ] Kubernetes deployment manifests

---

## License

MIT — see [LICENSE](LICENSE).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
