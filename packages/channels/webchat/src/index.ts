/**
 * WebChat channel — thin WebSocket transport for browser-based testing.
 *
 * This is the Phase 1 test channel. It:
 * 1. Serves a static HTML client (no build step needed)
 * 2. Connects to the gateway WebSocket endpoint
 * 3. Relays messages between browser and gateway
 *
 * Authentication: The browser client must obtain a Bearer token from the
 * CLI (`tessera token generate`) and include it in the WebSocket
 * upgrade request Authorization header.
 */

export const WEBCHAT_VERSION = "0.1.0";

// The static client HTML is in src/static/client.html
// Served by the gateway's static file handler or a separate HTTP server
