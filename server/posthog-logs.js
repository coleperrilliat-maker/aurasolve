import {OTLPLogExporter} from "@opentelemetry/exporter-logs-otlp-http";
import {resourceFromAttributes} from "@opentelemetry/resources";
import {BatchLogRecordProcessor, LoggerProvider} from "@opentelemetry/sdk-logs";

const projectToken = process.env.POSTHOG_PROJECT_TOKEN?.trim();
const host = process.env.POSTHOG_HOST?.trim();
const provider = projectToken && host
  ? new LoggerProvider({
    resource: resourceFromAttributes({
      "service.name": "aurasolve-api",
      "service.version": process.env.npm_package_version || "unknown",
      "deployment.environment": process.env.NODE_ENV || "development",
    }),
    processors: [new BatchLogRecordProcessor(new OTLPLogExporter({
      url: `${host.replace(/\/$/, "")}/i/v1/logs`,
      headers: {Authorization: `Bearer ${projectToken}`},
    }))],
  })
  : null;
const posthogLogger = provider?.getLogger("aurasolve.posthog") || null;
let shutdownPromise;

// This dedicated logger is intentionally separate from the application's console logs.
export function emitPostHogLog(record) {
  try {
    posthogLogger?.emit(record);
  } catch {}
}

export function shutdownPostHogLogs() {
  if (!provider) return Promise.resolve();
  if (!shutdownPromise) {
    shutdownPromise = new Promise(resolve => {
      const timeout = setTimeout(resolve, 2_000);
      provider.shutdown().catch(() => {}).finally(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  return shutdownPromise;
}
