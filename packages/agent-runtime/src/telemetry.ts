/**
 * telemetry.ts — OpenTelemetry setup for agent-runtime.
 *
 * Zero overhead when OTEL_EXPORTER_OTLP_ENDPOINT is unset (no SDK init).
 * Exports to any OTLP-compatible backend (Jaeger, Grafana Tempo, Honeycomb, Datadog).
 *
 * Usage:
 *   import { initTelemetry, getTracer, shutdownTelemetry } from "./telemetry.js";
 *   initTelemetry(); // call once at startup
 *   const tracer = getTracer();
 *   tracer.startActiveSpan("my.span", (span) => { ...; span.end(); });
 */
import { trace, type Tracer } from "@opentelemetry/api";

// Lazy imports — only loaded when OTEL endpoint is configured
let sdk: import("@opentelemetry/sdk-node").NodeSDK | null = null;

export function initTelemetry(): void {
  const endpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  if (!endpoint) return; // no-op — zero overhead when not configured

  // Dynamic imports to avoid loading OTel SDKs when not needed
  import("@opentelemetry/sdk-node").then(({ NodeSDK }) =>
    import("@opentelemetry/exporter-trace-otlp-http").then(({ OTLPTraceExporter }) =>
      import("@opentelemetry/resources").then(({ Resource }) =>
        import("@opentelemetry/semantic-conventions").then(({ ATTR_SERVICE_NAME }) => {
          sdk = new NodeSDK({
            resource: new Resource({ [ATTR_SERVICE_NAME]: "secureclaw-agent-runtime" }),
            traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
          });
          sdk.start();
          process.stdout.write(`[telemetry] OpenTelemetry exporting to ${endpoint}\n`);
        })
      )
    )
  ).catch((err: unknown) => {
    process.stderr.write(`[telemetry] Failed to initialize OTel: ${String(err)}\n`);
  });
}

export function getTracer(): Tracer {
  return trace.getTracer("secureclaw-agent-runtime", "0.1.0");
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
    } catch {
      // Ignore shutdown errors
    }
  }
}
