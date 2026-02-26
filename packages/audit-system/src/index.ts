export { AuditService } from "./audit.service.js";
export { ALERT_RULES } from "./alert-rules.js";
export { createAuditDatabase } from "./database/connection.js";
export { initSchema } from "./database/schema.js";
export { startAuditGrpcServer } from "./grpc/server.js";
export type { LogEventParams, LogEventResult, CostSummaryResult } from "./audit.service.js";
export type { AlertRule, AlertFinding, AlertContext } from "./alert-rules.js";

// ── Standalone server entry point ─────────────────────────────────────────
// Called when this package is run directly: node dist/index.js
const isMain = process.argv[1]?.endsWith("index.js");
if (isMain) {
  const { loadDotenv } = await import("@secureclaw/shared");
  loadDotenv();

  const { createAuditDatabase: createDb } = await import("./database/connection.js");
  const { initSchema: init } = await import("./database/schema.js");
  const { AuditService: Svc } = await import("./audit.service.js");
  const { startAuditGrpcServer: start } = await import("./grpc/server.js");

  const dataDir = process.env["AUDIT_DATA_DIR"] ?? "/tmp/secureclaw-audit";
  const db = createDb(dataDir);
  init(db);
  const costCapUsd = parseFloat(process.env["AUDIT_COST_CAP_USD"] ?? "5.0");
  const svc = new Svc(db, costCapUsd);
  await start(svc);
  process.stdout.write("[audit] Service ready\n");
}
