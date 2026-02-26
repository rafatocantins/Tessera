#!/usr/bin/env node
/**
 * bin.ts — SecureClaw CLI entry point.
 *
 * Commands:
 *   secureclaw init
 *   secureclaw token generate --user <id> [--secret <secret>]
 *   secureclaw session create  [--provider anthropic] [--token <t>] [--url <url>]
 *   secureclaw session status  <sessionId>            [--token <t>] [--url <url>]
 *   secureclaw session delete  <sessionId>            [--token <t>] [--url <url>]
 *   secureclaw health                                              [--url <url>]
 *   secureclaw skill publish|list|install|installed
 *
 * Environment variables (can be set in .env — run `secureclaw init`):
 *   GATEWAY_HMAC_SECRET  — HMAC secret for token generation
 *   GATEWAY_TOKEN        — Bearer token for API calls
 *   GATEWAY_URL          — Gateway base URL (default: http://127.0.0.1:18789)
 */
import { loadDotenv } from "@secureclaw/shared";
loadDotenv(); // load .env before any command reads process.env

import { Command } from "commander";
import { tokenCommand } from "./commands/token.js";
import { sessionCommand } from "./commands/session.js";
import { healthCommand } from "./commands/health.js";
import { skillCommand } from "./commands/skill.js";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("secureclaw")
  .description("SecureClaw — secure personal AI agent CLI")
  .version("0.1.0");

program.addCommand(initCommand());
program.addCommand(tokenCommand());
program.addCommand(sessionCommand());
program.addCommand(healthCommand());
program.addCommand(skillCommand());

program.parse();
