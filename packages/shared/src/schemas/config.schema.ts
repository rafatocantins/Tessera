import { z } from "zod";

// ---------------------------------------------------------------------------
// Security configuration — all defaults are the most restrictive option
// ---------------------------------------------------------------------------
export const SecurityConfigSchema = z.object({
  sandbox_mode: z
    .enum(["always_on", "off_for_dev"])
    .default("always_on"),
  tool_policy: z
    .enum(["deny_all_except_allowlist", "allow_all_except_denylist"])
    .default("deny_all_except_allowlist"),
  gateway_bind: z
    .enum(["loopback_only", "lan", "public"])
    .default("loopback_only"),
  gateway_auth: z
    .enum(["required_always", "optional"])
    .default("required_always"),
  credential_storage: z
    .enum(["os_native_vault", "env_file"])
    .default("os_native_vault"),
  session_isolation: z
    .enum(["strict", "relaxed"])
    .default("strict"),
  cost_cap_daily_usd: z.number().positive().default(5.0),
  audit_logging: z
    .enum(["all_tool_calls", "errors_only", "off"])
    .default("all_tool_calls"),
  telemetry: z
    .enum(["off", "anonymous", "full"])
    .default("off"),
  injection_detection: z
    .enum(["heuristic", "llm", "both"])
    .default("both"),
  human_approval_required_for: z
    .array(z.string())
    .default(["file_write", "file_delete", "shell_exec", "network_request", "browser_form_fill", "send_message"]),
  mdns_discovery: z
    .enum(["off", "minimal_no_paths", "full"])
    .default("minimal_no_paths"),
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

// ---------------------------------------------------------------------------
// Gateway configuration
// ---------------------------------------------------------------------------
export const GatewayConfigSchema = z.object({
  host: z.string().ip().default("127.0.0.1"),
  port: z.number().int().min(1024).max(65535).default(18789),
  max_request_size_bytes: z.number().int().default(1_048_576), // 1 MB
  rate_limit_per_minute: z.number().int().default(60),
  rate_limit_per_session_per_minute: z.number().int().default(30),
  websocket_ping_interval_ms: z.number().int().default(30_000),
  allowed_origins: z.array(z.string()).default(["http://127.0.0.1:3000"]),
  token_expiry_ms: z.number().int().default(5 * 60 * 1000), // 5 minutes
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

// ---------------------------------------------------------------------------
// LLM provider configurations
// ---------------------------------------------------------------------------
export const AnthropicProviderSchema = z.object({
  provider: z.literal("anthropic"),
  model: z.string().default("claude-3-5-sonnet-20241022"),
  credential_ref: z.string().describe("Opaque vault reference ID — never a raw key"),
  max_tokens: z.number().int().default(4096),
});

export const OpenAIProviderSchema = z.object({
  provider: z.literal("openai"),
  model: z.string().default("gpt-4o"),
  credential_ref: z.string().describe("Opaque vault reference ID — never a raw key"),
  max_tokens: z.number().int().default(4096),
  base_url: z.string().url().optional(),
});

export const GeminiProviderSchema = z.object({
  provider: z.literal("gemini"),
  model: z.string().default("gemini-2.0-flash"),
  credential_ref: z.string().describe("Opaque vault reference ID — never a raw key"),
  max_tokens: z.number().int().default(4096),
});

export const OllamaProviderSchema = z.object({
  provider: z.literal("ollama"),
  model: z.string().default("llama3.2"),
  base_url: z.string().url().default("http://127.0.0.1:11434"),
  max_tokens: z.number().int().default(4096),
});

export const LLMProviderConfigSchema = z.discriminatedUnion("provider", [
  AnthropicProviderSchema,
  OpenAIProviderSchema,
  GeminiProviderSchema,
  OllamaProviderSchema,
]);

export type LLMProviderConfig = z.infer<typeof LLMProviderConfigSchema>;

// ---------------------------------------------------------------------------
// gRPC address configuration
// ---------------------------------------------------------------------------
export const GrpcConfigSchema = z.object({
  cert_dir: z.string().default("/etc/secureclaw/certs"),
  agent_runtime_addr: z.string().default("127.0.0.1:19001"),
  vault_addr: z.string().default("127.0.0.1:19002"),
  audit_addr: z.string().default("127.0.0.1:19003"),
  sandbox_addr: z.string().default("127.0.0.1:19004"),
});

export type GrpcConfig = z.infer<typeof GrpcConfigSchema>;

// ---------------------------------------------------------------------------
// Tool policy entry
// ---------------------------------------------------------------------------
export const ToolPolicyEntrySchema = z.object({
  tool_id: z.string(),
  allowed: z.boolean().default(false),
  requires_approval: z.boolean().default(true),
  sandbox_required: z.boolean().default(true),
  max_executions_per_session: z.number().int().default(10),
  allowed_paths: z.array(z.string()).optional(),
  allowed_domains: z.array(z.string()).optional(),
  timeout_seconds: z.number().int().default(60),
  memory_bytes: z.number().int().default(268_435_456), // 256 MB
  pids_limit: z.number().int().default(64),
});

export type ToolPolicyEntry = z.infer<typeof ToolPolicyEntrySchema>;

// ---------------------------------------------------------------------------
// Root configuration
// ---------------------------------------------------------------------------
export const SecureClawConfigSchema = z.object({
  version: z.literal("1"),
  security: SecurityConfigSchema,
  gateway: GatewayConfigSchema,
  llm: LLMProviderConfigSchema,
  grpc: GrpcConfigSchema,
  tool_allowlist: z.array(ToolPolicyEntrySchema).default([]),
  workspace_dir: z.string().default("~/.secureclaw/workspace"),
  data_dir: z.string().default("~/.secureclaw/data"),
});

export type SecureClawConfig = z.infer<typeof SecureClawConfigSchema>;
