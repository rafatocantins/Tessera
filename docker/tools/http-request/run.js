/**
 * http-request tool runner — makes an HTTP request from the sandbox.
 *
 * Environment:
 *   TOOL_INPUT  JSON: {
 *     url: string,
 *     method?: "GET"|"POST"|"PUT"|"DELETE"|"PATCH",
 *     headers?: Record<string, string>,
 *     body?: string
 *   }
 *
 * Output format (stdout):
 *   HTTP <status> <statusText>
 *   <response body (truncated to 1 MB)>
 *
 * NOTE: network_mode for this tool must be set to "restricted" or "bridge"
 * at the caller level; this runner does not enforce allowed domains itself
 * (that is done at the policy / sandbox layer).
 */
"use strict";

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB response cap

async function main() {
  const rawInput = process.env["TOOL_INPUT"];
  if (!rawInput) {
    process.stderr.write("TOOL_INPUT env var is missing\n");
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(rawInput);
  } catch (e) {
    process.stderr.write(`Failed to parse TOOL_INPUT as JSON: ${e.message}\n`);
    process.exit(1);
  }

  const { url, method = "GET", headers = {}, body } = input;

  if (!url || typeof url !== "string") {
    process.stderr.write("url is required and must be a string\n");
    process.exit(1);
  }

  // Block obviously dangerous localhost / private range targets
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    process.stderr.write(`Invalid URL: ${url}\n`);
    process.exit(1);
  }

  const hostname = parsedUrl.hostname;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("169.254.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("172.16.") ||
    hostname.startsWith("192.168.")
  ) {
    process.stderr.write(`Requests to private/loopback addresses are not allowed: ${hostname}\n`);
    process.exit(1);
  }

  const allowedMethods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
  const upperMethod = (method || "GET").toUpperCase();
  if (!allowedMethods.includes(upperMethod)) {
    process.stderr.write(`Unsupported HTTP method: ${method}\n`);
    process.exit(1);
  }

  const fetchInit = {
    method: upperMethod,
    headers: headers && typeof headers === "object" ? headers : {},
    signal: AbortSignal.timeout(30_000),
  };

  if (body && typeof body === "string" && ["POST", "PUT", "PATCH"].includes(upperMethod)) {
    fetchInit.body = body;
  }

  let res;
  try {
    res = await fetch(url, fetchInit);
  } catch (err) {
    process.stderr.write(`Request failed: ${err.message}\n`);
    process.exit(1);
  }

  // Read response body with size cap
  let responseText = "";
  try {
    const reader = res.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    let truncated = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      if (totalBytes > MAX_BODY_BYTES) {
        truncated = true;
        break;
      }
      chunks.push(value);
    }
    reader.cancel().catch(() => {});

    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    responseText = buf.toString("utf-8");
    if (truncated) {
      responseText += "\n[... response truncated at 1 MB ...]";
    }
  } catch (err) {
    process.stderr.write(`Failed to read response body: ${err.message}\n`);
    process.exit(1);
  }

  process.stdout.write(`HTTP ${res.status} ${res.statusText}\n`);
  // Include content-type header
  const ct = res.headers.get("content-type");
  if (ct) process.stdout.write(`Content-Type: ${ct}\n`);
  process.stdout.write("\n");
  process.stdout.write(responseText);

  // Non-2xx is not an error at the tool level — caller decides
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Unhandled error: ${err.message || err}\n`);
  process.exit(1);
});
