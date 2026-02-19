/**
 * types.ts — TypeScript interfaces for all gRPC wire types.
 *
 * These mirror the .proto message definitions.
 * Kept in sync manually — one source of truth is the .proto files.
 */

// ── Agent Service ─────────────────────────────────────────────────────────

export interface GrpcCreateSessionRequest {
  user_id: string;
  provider: string;
  metadata: Record<string, string>;
}

export interface GrpcCreateSessionResponse {
  session_id: string;
  success: boolean;
  error_message: string;
}

export interface GrpcSendMessageRequest {
  session_id: string;
  content: string;
  content_type: string;
}

// AgentChunk is a oneof — exactly one field will be set
export interface GrpcAgentChunk {
  text?: GrpcTextChunk | undefined;
  tool_pending?: GrpcToolCallPendingChunk | undefined;
  tool_result?: GrpcToolCallResultChunk | undefined;
  injection_warning?: GrpcInjectionWarningChunk | undefined;
  complete?: GrpcSessionCompleteChunk | undefined;
  error?: GrpcErrorChunk | undefined;
}

export interface GrpcTextChunk {
  delta: string;
  is_final: boolean;
}

export interface GrpcToolCallPendingChunk {
  call_id: string;
  tool_id: string;
  input_preview: string;
  requires_approval: boolean;
  approval_timeout_seconds: number;
}

export interface GrpcToolCallResultChunk {
  call_id: string;
  tool_id: string;
  success: boolean;
  duration_ms: number;
  error_message: string;
}

export interface GrpcInjectionWarningChunk {
  excerpt: string;
  pattern_matched: string;
}

export interface GrpcSessionCompleteChunk {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  tool_calls_executed: number;
}

export interface GrpcErrorChunk {
  code: string;
  message: string;
}

export interface GrpcApproveToolCallRequest {
  session_id: string;
  call_id: string;
  approved: boolean;
}

export interface GrpcApproveToolCallResponse {
  success: boolean;
  error_message: string;
}

export interface GrpcTerminateSessionRequest {
  session_id: string;
}

export interface GrpcTerminateSessionResponse {
  success: boolean;
  total_cost_usd: number;
}

export interface GrpcGetSessionStatusRequest {
  session_id: string;
}

export interface GrpcGetSessionStatusResponse {
  session_id: string;
  status: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  tool_call_count: number;
}

// ── Vault Service ─────────────────────────────────────────────────────────

export interface GrpcSetSecretRequest {
  service: string;
  account: string;
  value: string;
}

export interface GrpcSetSecretResponse {
  ref_id: string;
  success: boolean;
  error_message: string;
}

export interface GrpcGetSecretRefRequest {
  service: string;
  account: string;
}

export interface GrpcGetSecretRefResponse {
  ref_id: string;
  exists: boolean;
}

export interface GrpcDeleteSecretRequest {
  service: string;
  account: string;
}

export interface GrpcDeleteSecretResponse {
  success: boolean;
}

export interface GrpcListSecretRefsRequest {}

export interface GrpcListSecretRefsResponse {
  refs: GrpcSecretRef[];
}

export interface GrpcSecretRef {
  ref_id: string;
  service: string;
  account: string;
  created_at: string;
}

export interface GrpcInjectCredentialRequest {
  ref_id: string;
  tool_input_json: string;
  placeholder_key: string;
}

export interface GrpcInjectCredentialResponse {
  mutated_input_json: string;
  success: boolean;
  error_message: string;
}

export interface GrpcScanRequest {
  path: string;
}

export interface GrpcScanResponse {
  warnings: string[];
  errors: string[];
}

// ── Audit Service ─────────────────────────────────────────────────────────

export interface GrpcLogEventRequest {
  event_type: string;
  session_id: string;
  user_id: string;
  payload_json: string;
  severity: string;
}

export interface GrpcLogEventResponse {
  event_id: number;
  success: boolean;
}

export interface GrpcQueryEventsRequest {
  session_id: string;
  from_unix_ms: number;
  to_unix_ms: number;
  event_types: string[];
  limit: number;
}

export interface GrpcAuditEvent {
  id: number;
  event_type: string;
  session_id: string;
  user_id: string;
  payload_json: string;
  severity: string;
  created_at_unix_ms: number;
}

export interface GrpcGetAlertsRequest {
  include_acknowledged: boolean;
  session_id: string;
}

export interface GrpcGetAlertsResponse {
  alerts: GrpcAlert[];
}

export interface GrpcAlert {
  id: number;
  rule_id: string;
  severity: string;
  session_id: string;
  message: string;
  context_json: string;
  created_at_unix_ms: number;
  acknowledged: boolean;
}

export interface GrpcAcknowledgeAlertRequest {
  alert_id: number;
}

export interface GrpcAcknowledgeAlertResponse {
  success: boolean;
}

export interface GrpcGetCostSummaryRequest {
  user_id: string;
  day_unix_ms: number;
}

export interface GrpcGetCostSummaryResponse {
  total_cost_usd: number;
  cap_usd: number;
  remaining_usd: number;
  cap_exceeded: boolean;
  cost_by_model: Record<string, number>;
}

export interface GrpcRecordCostRequest {
  session_id: string;
  user_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface GrpcRecordCostResponse {
  success: boolean;
}

// ── Sandbox Service ───────────────────────────────────────────────────────

export interface GrpcCheckRuntimeRequest {}

export interface GrpcCheckRuntimeResponse {
  gvisor_available: boolean;
  runtime_name: string;
  docker_version: string;
  ready: boolean;
  error_message: string;
}

export interface GrpcResourceLimits {
  memory_bytes: number;
  cpu_shares: number;
  pids_limit: number;
}

export interface GrpcRunToolRequest {
  call_id: string;
  tool_id: string;
  image: string;
  input_json: string;
  timeout_seconds: number;
  limits: GrpcResourceLimits;
  env_vars: string[];
  network_mode: string;
  allowed_domains: string[];
}

export interface GrpcRunToolResponse {
  container_id: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
  oom_killed: boolean;
}

export interface GrpcStopContainerRequest {
  container_id: string;
  timeout_seconds: number;
}

export interface GrpcStopContainerResponse {
  success: boolean;
}

// ── Skills Service ────────────────────────────────────────────────────────

export interface GrpcInstallSkillRequest {
  manifest_json: string;
  force: boolean;
}

export interface GrpcInstallSkillResponse {
  success: boolean;
  message: string;
  skill_id: string;
  skill_version: string;
  tools_registered: number;
}

export interface GrpcListSkillsRequest {
  namespace_filter: string;
  tag_filter: string;
}

export interface GrpcSkillSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  author_name: string;
  published_at: string;
  tags: string[];
  tool_count: number;
  installed_at: string;
}

export interface GrpcListSkillsResponse {
  skills: GrpcSkillSummary[];
}

export interface GrpcGetSkillRequest {
  skill_id: string;
  version: string;
}

export interface GrpcGetSkillResponse {
  found: boolean;
  manifest_json: string;
  installed_at: string;
}

export interface GrpcRemoveSkillRequest {
  skill_id: string;
  version: string;
}

export interface GrpcRemoveSkillResponse {
  success: boolean;
  message: string;
  versions_removed: number;
}

export interface GrpcExecuteSkillToolRequest {
  skill_id: string;
  skill_version: string;
  tool_id: string;
  input_json: string;
  call_id: string;
  session_id: string;
}

export interface GrpcExecuteSkillToolResponse {
  call_id: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  timed_out: boolean;
  oom_killed: boolean;
}

// ── Memory Service ────────────────────────────────────────────────────────

export interface GrpcStoreSessionRequest {
  session_id: string;
  user_id: string;
  provider: string;
  created_at: number;
}

export interface GrpcStoreSessionResponse {
  success: boolean;
}

export interface GrpcAppendMessageRequest {
  session_id: string;
  user_id: string;
  role: string;
  content: string;
  tool_calls_json: string;
  tool_call_id: string;
  tool_name: string;
  created_at: number;
}

export interface GrpcAppendMessageResponse {
  message_id: number;
  success: boolean;
}

export interface GrpcFinalizeSessionRequest {
  session_id: string;
  ended_at: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  tool_call_count: number;
}

export interface GrpcFinalizeSessionResponse {
  success: boolean;
}

export interface GrpcStoredMessage {
  id: number;
  session_id: string;
  user_id: string;
  role: string;
  content: string;
  tool_calls_json: string;
  tool_call_id: string;
  tool_name: string;
  created_at: number;
}

export interface GrpcGetRecentMessagesRequest {
  user_id: string;
  limit: number;
}

export interface GrpcGetRecentMessagesResponse {
  messages: GrpcStoredMessage[];
}

export interface GrpcSearchMessagesRequest {
  user_id: string;
  query: string;
  limit: number;
}

export interface GrpcDeleteUserDataRequest {
  user_id: string;
}

export interface GrpcDeleteUserDataResponse {
  deleted_count: number;
  success: boolean;
}

// ── Control UI — agent runtime extensions ──────────────────────────────────

export interface GrpcListSessionsRequest {}

export interface GrpcSessionSummary {
  session_id: string;
  user_id: string;
  provider: string;
  status: string;
  created_at: number;
  last_activity_at: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  tool_call_count: number;
}

export interface GrpcListSessionsResponse {
  sessions: GrpcSessionSummary[];
}

export interface GrpcListPendingApprovalsRequest {}

export interface GrpcPendingApprovalSummary {
  call_id: string;
  session_id: string;
  user_id: string;
  tool_id: string;
  input_preview: string;
  requested_at: number;
  expires_at: number;
}

export interface GrpcListPendingApprovalsResponse {
  approvals: GrpcPendingApprovalSummary[];
}
