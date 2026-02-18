#!/usr/bin/env node
/**
 * bin.ts — SecureClaw CLI entry point.
 *
 * Commands:
 *   secureclaw token generate --user <id> [--secret <secret>]
 *   secureclaw session create  [--provider anthropic] [--token <t>] [--url <url>]
 *   secureclaw session status  <sessionId>            [--token <t>] [--url <url>]
 *   secureclaw session delete  <sessionId>            [--token <t>] [--url <url>]
 *   secureclaw health                                              [--url <url>]
 *
 * Environment variables:
 *   GATEWAY_HMAC_SECRET  — HMAC secret for token generation
 *   GATEWAY_TOKEN        — Bearer token for API calls
 *   GATEWAY_URL          — Gateway base URL (default: http://127.0.0.1:18789)
 */
import { Command } from "commander";
import { tokenCommand } from "./commands/token.js";
import { sessionCommand } from "./commands/session.js";
import { healthCommand } from "./commands/health.js";

const program = new Command();

program
  .name("secureclaw")
  .description("SecureClaw — secure personal AI agent CLI")
  .version("0.1.0");

program.addCommand(tokenCommand());
program.addCommand(sessionCommand());
program.addCommand(healthCommand());

program.parse();
