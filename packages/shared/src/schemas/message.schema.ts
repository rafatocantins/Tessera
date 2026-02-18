import { z } from "zod";

export const MessageRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "tool",
]);

export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const LLMMessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  tool_call_id: z.string().optional(),
  tool_name: z.string().optional(),
});

export type LLMMessage = z.infer<typeof LLMMessageSchema>;

// Content type tagging for injection defense
export const ContentTypeSchema = z.enum([
  "INSTRUCTION", // From the authenticated user (trusted)
  "DATA",        // From external sources: web, email, files (never treated as instructions)
  "SYSTEM",      // System-generated (trusted)
]);

export type ContentType = z.infer<typeof ContentTypeSchema>;

export const TaggedContentSchema = z.object({
  content_type: ContentTypeSchema,
  content: z.string(),
  source: z.string().optional(), // URL, file path, email address, etc.
  session_delimiter: z.string(), // Unique per session; used to detect injection escape attempts
});

export type TaggedContent = z.infer<typeof TaggedContentSchema>;

// The WebSocket message protocol between client and gateway
export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    session_id: z.string().uuid(),
    content: z.string().max(32_768),
  }),
  z.object({
    type: z.literal("approve"),
    session_id: z.string().uuid(),
    call_id: z.string(),
    approved: z.boolean(),
  }),
  z.object({
    type: z.literal("ping"),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chunk"), session_id: z.string(), delta: z.string() }),
  z.object({
    type: z.literal("tool_pending"),
    session_id: z.string(),
    call_id: z.string(),
    tool_id: z.string(),
    description: z.string(),
    requires_approval: z.boolean(),
  }),
  z.object({
    type: z.literal("tool_result"),
    session_id: z.string(),
    call_id: z.string(),
    success: z.boolean(),
    duration_ms: z.number().int(),
  }),
  z.object({
    type: z.literal("complete"),
    session_id: z.string(),
    cost_usd: z.number(),
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
  }),
  z.object({
    type: z.literal("error"),
    session_id: z.string().optional(),
    code: z.string(),
    message: z.string(),
  }),
  z.object({ type: z.literal("pong") }),
  z.object({
    type: z.literal("injection_warning"),
    session_id: z.string(),
    excerpt: z.string().describe("First 200 chars of suspicious content"),
  }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
