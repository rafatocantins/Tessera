# Tessera — Testing & Usage Guide

This guide covers everything you need to build, start, and test Tessera
end-to-end on your own machine. The guide assumes **Node.js 22.13+**, **pnpm 9+**,
and a terminal. Windows users: read the Windows-specific section below before
starting.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Build the project](#2-build-the-project)
3. [Start the services](#3-start-the-services)
4. [Get a bearer token](#4-get-a-bearer-token)
5. [Health check](#5-health-check)
6. [Chat with the agent](#6-chat-with-the-agent)
7. [Credential vault](#7-credential-vault)
8. [Audit log](#8-audit-log)
9. [EU AI Act compliance report](#9-eu-ai-act-compliance-report)
10. [Cost showback](#10-cost-showback)
11. [Skills marketplace](#11-skills-marketplace)
12. [Control UI (browser dashboard)](#12-control-ui-browser-dashboard)
13. [CLI reference](#13-cli-reference)
14. [Stopping all services](#14-stopping-all-services)
15. [Windows setup notes](#15-windows-setup-notes)
16. [Docker Compose (production)](#16-docker-compose-production)
17. [Running the test suite](#17-running-the-test-suite)

---

## 1. Prerequisites

| Requirement | Minimum version | Check |
|---|---|---|
| Node.js | **22.13** LTS | `node --version` |
| pnpm | 9.x | `pnpm --version` |
| Git | any | `git --version` |

> **Why 22.13?** Tessera uses Node.js's built-in `node:sqlite` module
> (no native compilation, no `node-gyp`, no Visual Studio Build Tools).
> This module is unflagged from Node.js 22.13 onwards.

Optional (for specific features):

- **An Anthropic API key** — required to get real LLM responses.
  Without it the agent starts and connects, but all chat returns a provider
  error. Set it via `tessera init` or in `.env`.
- **Docker Desktop** — only needed for the sandbox runtime (tool execution)
  and for the Docker Compose production stack.
- **Trivy** — only needed for `tessera skill publish --trivy`.
  Install from <https://trivy.dev>.

---

## 2. Build the project

```bash
# Install all workspace dependencies (first time only)
pnpm install

# Build every package — takes ~30 s the first time
pnpm -r build
```

A clean build prints no errors and ends with all packages reporting `Done`.
You can also run just one package:

```bash
pnpm --filter '@tessera/gateway' build
```

---

## 3. Start the services

### Option A — One command (recommended)

Run these two commands in the repository root, **first time only**:

```bash
# Generate secrets, create .env, and print next steps
tessera init
```

Follow the prompts:
- Press **Enter** to accept the default model (`claude-sonnet-4-6`)
- Paste an **Anthropic API key** when asked (or press Enter to skip for Ollama / offline use)
- Press **Enter** to skip the Ollama URL unless you use a local model

Once `.env` exists, start everything:

```bash
pnpm dev
```

`pnpm dev` launches all 8 services and the Control UI in parallel with
colour-coded, labelled output. Any crash is immediately visible. Press
`Ctrl+C` to stop everything.

Expected output (first few seconds):
```
[vault]   [vault-grpc] Server listening on 0.0.0.0:19002
[audit]   [audit-grpc] Server listening on 0.0.0.0:19003
[mem]     [memory-grpc] Server listening on 0.0.0.0:19006
[skills]  [skills-engine] Ready. Skills installed: 0, Marketplace entries: 0
[box]     [sandbox-grpc] Server listening on 0.0.0.0:19004
[agent]   [agent-runtime] Service ready
[gw]      [gateway] Dev token (for testing): dev-user.XXXXXXXXXX.YYYYYYYY
[gw]      [gateway] Listening on http://127.0.0.1:18789
[ui]      VITE v7.x.x  ready in 300 ms
[ui]      ➜  Local:   http://127.0.0.1:5173/
```

**Save the dev token printed by `[gw]`** — you will use it in every API call.

If you skip `tessera init`, the gateway falls back to an insecure dev
default (`dev-insecure-change-me`) and prints a warning. Fine for local
testing; run `tessera init` before any real use.

To start the backend services without the Vite UI:

```bash
pnpm dev:services
```

---

### Option B — Individual terminals (for debugging a single service)

If you need to isolate one service, you can start each one manually.
`.env` is loaded automatically — no `export` needed.

**Audit system (port 19003)**
```bash
node packages/audit-system/dist/index.js
```

**Credential vault (port 19002)**
```bash
node packages/credential-vault/dist/index.js
```
Expected on WSL/headless Linux: `[vault] Backend: encrypted file (keytar unavailable)`
Expected on native Windows/macOS: `[vault] Backend: OS keychain (keytar)`

**Memory store (port 19006)**
```bash
node packages/memory-store/dist/index.js
```

**Skills engine (port 19005)**
```bash
node packages/skills-engine/dist/index.js
```

**Agent runtime (port 19001)**
```bash
# TESSERA_ALLOW_RUNC=true skips the gVisor requirement in dev
TESSERA_ALLOW_RUNC=true node packages/agent-runtime/dist/index.js
```

**Gateway (port 18789)**
```bash
node packages/gateway/dist/index.js
```

**Control UI (port 5173)**
```bash
cd apps/control-ui && pnpm dev
```

> **Security note:** The gateway binds to `127.0.0.1` only. It is never
> accessible from the network without an explicit reverse proxy.

---

## 4. Get a bearer token

The gateway prints a dev token at startup (see above). You can also generate
one at any time with the CLI:

```bash
# Generates a token for user "dev-user" signed with "dev-secret"
node packages/cli/dist/bin.js token generate \
  --user dev-user \
  --secret dev-secret
```

Output:
```
dev-user.1740123456789.a1b2c3d4e5f6...
```

Store it in a variable for the examples below:

```bash
TOKEN="dev-user.1740123456789.a1b2c3d4e5f6..."
```

Or use an environment variable so every CLI command picks it up automatically:

```bash
export GATEWAY_TOKEN="dev-user.1740123456789.a1b2c3d4e5f6..."
export GATEWAY_HMAC_SECRET=dev-secret
```

---

## 5. Health check

```bash
curl http://127.0.0.1:18789/health
```

Expected response:
```json
{"status":"ok"}
```

This endpoint requires no authentication.

---

## 6. Chat with the agent

### 6.1 Create a session

```bash
curl -s -X POST http://127.0.0.1:18789/api/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"anthropic","model":"claude-sonnet-4-6"}' | jq .
```

Response:
```json
{
  "session_id": "sess_abc123...",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "created_at": "2026-02-26T00:00:00.000Z"
}
```

Save the session ID:
```bash
SESSION_ID="sess_abc123..."
```

### 6.2 Send a message

```bash
curl -s -X POST http://127.0.0.1:18789/api/v1/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"message\":\"Hello! What can you do?\"}" | jq .
```

The response contains the agent's reply and metadata (tokens used, cost, any
tool calls that were made).

### 6.3 Webchat UI

Open `packages/channel-webchat/index.html` in a browser. Enter your token
and session ID to chat interactively — no server needed for the web client,
it connects directly to the gateway via WebSocket.

### 6.4 Memory: conversations persist across sessions

The agent automatically loads the last 30 messages from the memory store at
the start of each new session. Start a new session with the same user and
ask "what did we talk about?" — the agent will recall earlier messages.

---

## 7. Credential vault

The vault stores secrets encrypted at rest and injects them into tool calls
as `__VAULT_REF:id__` placeholders. The LLM never sees the raw values.

### 7.1 Store a credential

```bash
curl -s -X POST http://127.0.0.1:18789/api/v1/credentials \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-api-key","value":"sk-super-secret-1234","description":"Test API key"}' | jq .
```

Response:
```json
{
  "ref_id": "vault:my-api-key",
  "name": "my-api-key",
  "created_at": "2026-02-26T00:00:00.000Z"
}
```

### 7.2 List credentials

```bash
curl -s http://127.0.0.1:18789/api/v1/credentials \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Note: only names and ref IDs are returned — never values.

### 7.3 Delete a credential

```bash
curl -s -X DELETE http://127.0.0.1:18789/api/v1/credentials/my-api-key \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### 7.4 Inject a credential into a tool call

In a chat message, reference the credential by its placeholder:

```
Use __VAULT_REF:my-api-key__ to authenticate the HTTP request.
```

The agent runtime replaces the placeholder with the real value before calling
the tool, and strips it from the LLM context before the response is returned.

---

## 8. Audit log

The audit log is append-only (SQLite write triggers block UPDATE/DELETE).

```bash
# Fetch the last 20 events
curl -s "http://127.0.0.1:18789/api/v1/audit/events?limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Query by event type:
```bash
curl -s "http://127.0.0.1:18789/api/v1/audit/events?event_type=TOOL_CALL&limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Event types to look for after sending a chat message:
- `SESSION_START` — session created
- `LLM_REQUEST` — LLM call sent
- `TOOL_CALL` — tool execution attempted
- `APPROVAL_REQUESTED` — human approval required
- `APPROVAL_GRANTED` / `APPROVAL_DENIED` / `APPROVAL_TIMEOUT`
- `POLICY_DENIED` — tool blocked by policy
- `INJECTION_DETECTED` — prompt injection attempt detected

---

## 9. EU AI Act compliance report

Generates an EU AI Act 2024/1689 compliance summary derived from audit events.
Covers Articles 9, 12, 14, and 15.

```bash
# Report for the last 30 days (default)
curl -s "http://127.0.0.1:18789/api/v1/compliance/report" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Example response:
```json
{
  "generated_at_iso": "2026-02-26T00:00:00.000Z",
  "framework_version": "EU AI Act 2024/1689",
  "overall_status": "COMPLIANT",
  "articles": [
    {
      "article_id": "article_9_risk_management",
      "status": "COMPLIANT",
      "summary": "Deny-by-default policy engine active; injection detection enabled",
      "evidence": { "policyDenied": 0, "injectionDetected": 0, "policy": "deny_all_except_allowlist" }
    },
    {
      "article_id": "article_12_transparency_logging",
      "status": "COMPLIANT",
      "summary": "5 immutable audit events; tamper-resistant SQLite triggers",
      "evidence": { "totalEvents": 5, "tamper_resistant": true }
    },
    {
      "article_id": "article_14_human_oversight",
      "status": "COMPLIANT",
      "summary": "0 approvals requested; 100% resolved",
      "evidence": { "approvalRequested": 0, "oversightRate": 1 }
    },
    {
      "article_id": "article_15_cybersecurity",
      "status": "COMPLIANT",
      "summary": "gVisor sandbox + session delimiters + multi-layer injection defense",
      "evidence": { "sandbox_mode": "gVisor" }
    }
  ],
  "issues": []
}
```

Custom date range:
```bash
FROM=$(date -d "7 days ago" +%s%3N)  # last 7 days (Linux)
TO=$(date +%s%3N)
curl -s "http://127.0.0.1:18789/api/v1/compliance/report?from=$FROM&to=$TO" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Download as a JSON file (for auditors):
```bash
curl -s "http://127.0.0.1:18789/api/v1/compliance/report/export" \
  -H "Authorization: Bearer $TOKEN" \
  -o eu-ai-act-report.json
echo "Saved to eu-ai-act-report.json"
```

---

## 10. Cost showback

Records LLM token usage per user/session and aggregates by team. The team is
derived from the `userId` in the token: `acme/alice` → team `acme`; a solo
`alice` is her own team.

```bash
# All teams, last 30 days
curl -s "http://127.0.0.1:18789/api/v1/costs/teams" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

```bash
# Single team
curl -s "http://127.0.0.1:18789/api/v1/costs/teams/dev-user" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Download as CSV (for FinOps / spreadsheet tools):
```bash
curl -s "http://127.0.0.1:18789/api/v1/costs/export" \
  -H "Authorization: Bearer $TOKEN" \
  -o tessera-costs.csv
cat tessera-costs.csv
```

CSV format:
```
team_id,total_cost_usd,input_tokens,output_tokens,session_count
dev-user,0.002500,1500,800,2
```

---

## 11. Skills marketplace

Skills are signed tool bundles (Ed25519 signatures) that extend the agent with
new capabilities. The marketplace allows publishing and installing them.

### 11.1 Browse the marketplace (public — no token needed)

```bash
curl -s "http://127.0.0.1:18789/api/v1/marketplace" | jq .
```

Filter:
```bash
curl -s "http://127.0.0.1:18789/api/v1/marketplace?search=web&tag=nlp" | jq .
```

Or use the CLI:
```bash
node packages/cli/dist/bin.js skill list
node packages/cli/dist/bin.js skill list --search web
node packages/cli/dist/bin.js skill list --namespace tessera
```

### 11.2 Prepare a signed skill manifest

Skills must be signed with an Ed25519 key. Here is the minimum valid manifest
for testing:

```bash
# 1. Generate a key pair (Node.js one-liner)
node -e "
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const sk = privateKey.export({ type: 'pkcs8', format: 'der' });
const pk = publicKey.export({ type: 'spki', format: 'der' });
// Strip ASN.1 headers — raw 32-byte keys
const rawSk = sk.slice(-32);
const rawPk = pk.slice(-32);
console.log('PRIVATE_KEY=' + rawSk.toString('hex'));
console.log('PUBLIC_KEY=' + rawPk.toString('hex'));
"
```

Copy the keys, then sign a manifest:

```bash
node -e "
const { createPrivateKey, sign } = require('crypto');
const PRIVATE_HEX = 'YOUR_PRIVATE_KEY_HEX';
const PUBLIC_HEX  = 'YOUR_PUBLIC_KEY_HEX';

const manifest = {
  id: 'demo/hello',
  version: '1.0.0',
  name: 'Hello World',
  description: 'A minimal demo skill',
  author_name: 'Demo Author',
  author_url: 'https://example.com',
  tags: ['demo'],
  min_agent_version: '0.1.0',
  tools: [],
  permissions: { network: false, filesystem: false, shell: false }
};

// Canonical form for signing
const canonical = JSON.stringify(
  Object.keys(manifest).sort().reduce((o, k) => { o[k] = manifest[k]; return o; }, {})
);
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(PRIVATE_HEX, 'hex')]),
  format: 'der', type: 'pkcs8'
});
const sig = sign(null, Buffer.from(canonical), key).toString('hex');

const signed = { ...manifest, signature: sig, public_key: PUBLIC_HEX };
require('fs').writeFileSync('demo-skill.json', JSON.stringify(signed, null, 2));
console.log('Written to demo-skill.json');
"
```

### 11.3 Publish a skill

```bash
# Without Trivy scan
node packages/cli/dist/bin.js skill publish demo-skill.json \
  --token "$TOKEN"

# With Trivy security scan (requires Trivy installed)
node packages/cli/dist/bin.js skill publish demo-skill.json \
  --token "$TOKEN" \
  --trivy
```

Output:
```
published: demo/hello@1.0.0
message:   Skill demo/hello@1.0.0 published to marketplace
```

Or with curl:
```bash
MANIFEST=$(cat demo-skill.json)
curl -s -X POST http://127.0.0.1:18789/api/v1/marketplace/publish \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"manifest_json\":$(echo $MANIFEST | jq -Rs .),\"trivy_scan_passed\":false}" | jq .
```

### 11.4 Install a skill from the marketplace

```bash
node packages/cli/dist/bin.js skill install demo/hello@1.0.0 \
  --token "$TOKEN"
```

Output:
```
installed: demo/hello@1.0.0
tools:     0 registered
message:   Skill demo/hello installed
Restart agent-runtime to activate the new skill.
```

After restarting agent-runtime (Tab 5), the skill's tools are available to the
agent in all new sessions.

### 11.5 List installed skills

```bash
node packages/cli/dist/bin.js skill installed --token "$TOKEN"
```

---

## 12. Control UI (browser dashboard)

The Control UI is a React app (Vite) that provides a visual interface for all
features. It requires the gateway to be running.

```bash
cd apps/control-ui
pnpm dev
```

Open **http://127.0.0.1:5173** in your browser.

**Login screen:** Enter the HMAC secret (`dev-secret` in development). The UI
derives tokens internally — you never paste a token here.

**Seven tabs:**

| Tab | What it shows |
|---|---|
| **Approvals** | Real-time queue of tool calls awaiting human approval. Badge shows pending count. |
| **Sessions** | All active and completed agent sessions. |
| **Audit Log** | Live stream of all audit events with type filter. |
| **Credentials** | Create, list, and delete vault entries. Never shows raw values. |
| **Compliance** | EU AI Act article cards (green = COMPLIANT, yellow = WARNING). Date range picker, JSON export, clipboard copy. |
| **Costs** | Team cost bars with model breakdown. 30-second auto-refresh. CSV export button. |
| **Marketplace** | Skill cards with search box and tag filter. Install button per skill. |

**Approvals workflow:** When the agent calls a high-risk tool (`file_write`,
`shell_exec`, `http_request`), it pauses and posts an approval request. The
Approvals tab shows the tool call details. Click **Allow** to proceed or
**Deny** to block it. The agent receives the decision and continues (or stops).

---

## 13. CLI reference

```
tessera init                                          # First-run wizard: secrets + .env
tessera token generate --user <id> [--secret <s>]    # Generate a bearer token
tessera health [--url <url>]                          # Check gateway health
tessera session create [--provider anthropic] [--token <t>]
tessera session status <sessionId>            [--token <t>]
tessera session delete <sessionId>            [--token <t>]
tessera skill list     [--search <q>] [--namespace <ns>] [--tag <t>]
tessera skill publish  <manifest.json> [--trivy] [--token <t>]
tessera skill install  <ns/name[@ver]>        [--token <t>]
tessera skill installed                       [--token <t>]
```

All commands accept `--url <base>` to target a non-default gateway address.
`--token` defaults to `$GATEWAY_TOKEN`. `--secret` defaults to
`$GATEWAY_HMAC_SECRET`.

Build the CLI first if needed:
```bash
pnpm --filter '@tessera/cli' build
```

Run it directly:
```bash
node packages/cli/dist/bin.js --help
```

Or install it globally:
```bash
npm install -g packages/cli
tessera --help
```

---

## 14. Stopping all services

Press `Ctrl+C` in each terminal tab. The services handle `SIGINT` gracefully,
flushing any in-progress work before exit.

To stop everything at once (if you used `&` to background them):
```bash
pkill -f "packages/.*/dist/index.js"
```

Data is persisted between restarts:
- Vault secrets: `$VAULT_DATA_DIR/keys.enc.json` (default: `/tmp/tessera-vault/`)
- Audit events: `$AUDIT_DATA_DIR/audit.db` (default: `/tmp/tessera-audit/`)
- Memory: `$MEMORY_DATA_DIR/memory.db` (default: `/tmp/tessera-memory/`)
- Skills registry: `$SKILLS_REGISTRY_PATH` (default: `/tmp/tessera-skills-registry.json`)
- Marketplace: `$MARKETPLACE_REGISTRY_PATH` (default: `/tmp/tessera-marketplace-registry.json`)

---

## 15. Windows setup notes

Running on **native Windows** (PowerShell or CMD — not WSL) gives you the
strongest credential security because keytar uses **Windows Credential Manager**
(backed by DPAPI, optionally TPM).

### Prerequisites on Windows

1. Install **Node.js 22.13 LTS** from https://nodejs.org (choose the Windows installer).
2. Install **pnpm**: `npm install -g pnpm`

That's it. Tessera uses Node.js's **built-in** `node:sqlite` module — no
Visual Studio Build Tools, no Python, no `node-gyp`. Everything installs from
pure JavaScript packages.

### Build and run (PowerShell)

```powershell
# From the repository root
pnpm install
pnpm -r build

# First-run setup (generates .env with secrets)
node packages\cli\dist\bin.js init

# Start all services
pnpm dev
```

On first start the vault will use the Windows Credential Manager:
```
[vault]  [vault] Backend: OS keychain (keytar)
```

Your credentials will appear in **Control Panel → Credential Manager →
Windows Credentials** under names starting with `Tessera:`.

### Environment variables in PowerShell

The `.env` file created by `tessera init` is loaded automatically by all
services. If you need to override a value for a single run:

```powershell
$env:TESSERA_ALLOW_RUNC = "true"
node packages\agent-runtime\dist\index.js
```

### Paths on Windows

Replace forward slashes with backslashes in file paths when running individual
service commands. `pnpm dev` handles this automatically. The SQLite and JSON
data files default to `%TEMP%\tessera-*` on Windows.

---

## 16. Docker Compose (production)

The Docker Compose stack builds all services into containers with hardened
defaults (read-only filesystems, dropped capabilities, loopback-only ports).

### Required: generate mTLS certificates first

```bash
bash scripts/gen-certs.sh
```

### Required environment variables

```bash
export GATEWAY_HMAC_SECRET="$(openssl rand -hex 32)"
export VAULT_MASTER_KEY="$(openssl rand -hex 32)"
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Start the core stack

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Add messaging channels (optional)

```bash
export TELEGRAM_BOT_TOKEN="..."
export SLACK_BOT_TOKEN="..."
export SLACK_APP_TOKEN="..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml \
  --profile channels up -d
```

### Check status

```bash
docker compose ps
docker compose logs gateway
```

### Stop and clean up

```bash
docker compose down -v   # removes containers and volumes
```

> **Note:** The Docker sandbox runtime requires gVisor (`runsc`) installed on
> the host. Without it, set `TESSERA_ALLOW_RUNC=true` in the agent-runtime
> service environment — for development only.

---

## 17. Running the test suite

```bash
# All 228 tests (shared + audit-system + skills-engine + memory-store + agent-runtime)
pnpm --filter '@tessera/shared' \
     --filter '@tessera/audit-system' \
     --filter '@tessera/skills-engine' \
     --filter '@tessera/memory-store' \
     --filter '@tessera/agent-runtime' \
     test
```

Expected output: **228 tests, all passing**.

```bash
# Full typecheck (all packages)
pnpm -r typecheck
```

### Integration tests (requires Docker)

The integration suite starts the full Docker Compose stack, sends real HTTP
requests through the gateway, and tears down cleanly.

```bash
cd packages/integration
pnpm test
```

---

## Quick reference card

| What | Command |
|---|---|
| **First-run setup** | `tessera init` |
| Install dependencies | `pnpm install` |
| Build everything | `pnpm -r build` |
| **Start all services + UI** | `pnpm dev` |
| Start backend only (no UI) | `pnpm dev:services` |
| Generate token | `node packages/cli/dist/bin.js token generate --user dev-user` |
| Health check | `curl http://127.0.0.1:18789/health` |
| Chat | `curl -X POST .../api/v1/chat -H "Authorization: Bearer $TOKEN" -d '{...}'` |
| Compliance report | `curl .../api/v1/compliance/report -H "Authorization: Bearer $TOKEN"` |
| Cost summary | `curl .../api/v1/costs/teams -H "Authorization: Bearer $TOKEN"` |
| Marketplace browse | `curl http://127.0.0.1:18789/api/v1/marketplace` |
| Open Control UI | `open http://127.0.0.1:5173` |
| Run tests | `pnpm -r test` |
