import type {
  BackendLogEntry,
  PluginInfo,
  ProgramStatus,
  Settings,
  StatusReport,
} from './types';
import { downloadJson, timestampForFilename } from './download';

interface DiagnosticsSystemInfo {
  appVersion: string;
  node: string;
  platform: string;
  release: string;
  arch: string;
  uptimeSeconds: number;
}

/**
 * Redacts a plugin's password-typed fields (Tuya local key, webhook URL,
 * bot token, etc. - whatever that plugin's own settingsSchema marks
 * type:"password", the same signal PluginCard.tsx already uses to mask
 * them in the UI) while keeping the key present so it's still visible
 * *whether* something was ever configured, without exposing the value
 * itself - that distinction matters for troubleshooting ("did they even
 * set a local key") without needing the actual secret.
 */
function redactPluginConfig(plugin: PluginInfo): Record<string, unknown> {
  const sensitiveKeys = new Set(
    (plugin.schema?.fields ?? []).filter((f) => f.type === 'password' && f.key).map((f) => f.key as string),
  );
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(plugin.config)) {
    if (!sensitiveKeys.has(key)) {
      redacted[key] = value;
      continue;
    }
    redacted[key] = value ? '[redacted]' : '[not set]';
  }
  return redacted;
}

export interface DiagnosticsInput {
  connectionOpen: boolean;
  status: StatusReport | null;
  programStatus: ProgramStatus;
  settings: Settings | null;
  plugins: PluginInfo[];
  backendLog: BackendLogEntry[];
}

/** Everything an issue report/support request would plausibly need about this Pi's app state - explicitly excludes G-code file names/content and any plugin field its own schema marks sensitive. */
export async function buildDiagnosticsBundle(input: DiagnosticsInput): Promise<Record<string, unknown>> {
  let system: DiagnosticsSystemInfo | { error: string };
  try {
    const res = await fetch('/api/diagnostics');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    system = (await res.json()) as DiagnosticsSystemInfo;
  } catch (err) {
    system = { error: err instanceof Error ? err.message : String(err) };
  }

  return {
    exportedAt: new Date().toISOString(),
    system,
    connection: { isOpen: input.connectionOpen },
    machineStatus: input.status,
    program: input.programStatus,
    settings: { general: input.settings?.general ?? null },
    plugins: input.plugins.map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      enabled: p.config.enabled,
      config: redactPluginConfig(p),
    })),
    backendLog: input.backendLog,
  };
}

export function downloadDiagnostics(bundle: Record<string, unknown>): void {
  downloadJson(`fluidnc-webcontrol-diagnostics-${timestampForFilename()}.json`, bundle);
}
