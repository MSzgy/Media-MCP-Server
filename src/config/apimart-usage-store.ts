import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type ApiMartCapability = "image" | "video" | "audio" | "upload" | "status" | "balance";

interface ApiMartUsageCall {
  method: string;
  endpoint: string;
  capability: ApiMartCapability;
  model?: string;
  ok: boolean;
  statusCode?: number;
  at: string;
}

export interface ApiMartUsageStats {
  total: number;
  success: number;
  failed: number;
  byCapability: Record<string, number>;
  byModel: Record<string, number>;
  byEndpoint: Record<string, number>;
  lastUsedAt?: string;
  recentCalls: ApiMartUsageCall[];
}

interface PersistedApiMartUsageStats {
  usageStats: ApiMartUsageStats;
  updatedAt: string;
}

const USAGE_STATS_PATH = path.resolve(
  process.cwd(),
  process.env.MCP_APIMART_USAGE_STATS_PATH ?? ".media-mcp-apimart-usage.json"
);

function emptyStats(): ApiMartUsageStats {
  return {
    total: 0,
    success: 0,
    failed: 0,
    byCapability: {},
    byModel: {},
    byEndpoint: {},
    recentCalls: []
  };
}

function normalizeStats(stats?: Partial<ApiMartUsageStats>): ApiMartUsageStats {
  return {
    total: stats?.total ?? 0,
    success: stats?.success ?? 0,
    failed: stats?.failed ?? 0,
    byCapability: stats?.byCapability ?? {},
    byModel: stats?.byModel ?? {},
    byEndpoint: stats?.byEndpoint ?? {},
    lastUsedAt: stats?.lastUsedAt,
    recentCalls: stats?.recentCalls ?? []
  };
}

function readPersistedUsageStats(): ApiMartUsageStats {
  if (!existsSync(USAGE_STATS_PATH)) {
    return emptyStats();
  }
  try {
    const persisted = JSON.parse(readFileSync(USAGE_STATS_PATH, "utf8")) as PersistedApiMartUsageStats;
    return normalizeStats(persisted.usageStats);
  } catch {
    return emptyStats();
  }
}

function writePersistedUsageStats(usageStats: ApiMartUsageStats): void {
  mkdirSync(path.dirname(USAGE_STATS_PATH), { recursive: true });
  writeFileSync(
    USAGE_STATS_PATH,
    `${JSON.stringify({ usageStats, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

export class ApiMartUsageStore {
  private usageStats = readPersistedUsageStats();

  getPayload() {
    this.usageStats = readPersistedUsageStats();
    return {
      usageStatsPath: USAGE_STATS_PATH,
      usageStats: this.usageStats
    };
  }

  recordCall(call: Omit<ApiMartUsageCall, "at">): ApiMartUsageStats {
    const at = new Date().toISOString();
    const current = normalizeStats(this.usageStats);
    const nextCall: ApiMartUsageCall = { ...call, at };
    const next = {
      total: current.total + 1,
      success: current.success + (call.ok ? 1 : 0),
      failed: current.failed + (call.ok ? 0 : 1),
      byCapability: {
        ...current.byCapability,
        [call.capability]: (current.byCapability[call.capability] ?? 0) + 1
      },
      byModel: call.model
        ? {
          ...current.byModel,
          [call.model]: (current.byModel[call.model] ?? 0) + 1
        }
        : current.byModel,
      byEndpoint: {
        ...current.byEndpoint,
        [call.endpoint]: (current.byEndpoint[call.endpoint] ?? 0) + 1
      },
      lastUsedAt: at,
      recentCalls: [nextCall, ...current.recentCalls].slice(0, 30)
    };
    this.usageStats = next;
    writePersistedUsageStats(next);
    return next;
  }
}
