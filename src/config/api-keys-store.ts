import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type KeySource = "env" | "ui";
type SelectionMode = "manual" | "round-robin";

interface PersistedKey {
  id: string;
  label: string;
  rawKey: string;
  source: KeySource;
  enabled: boolean;
}

export interface ApiKeyUsageStats {
  total: number;
  byModel: Record<string, number>;
  lastUsedAt?: string;
}

interface PersistedSettings {
  keys: PersistedKey[];
  selectionMode: SelectionMode;
  activeKeyId?: string;
  /** @deprecated Usage stats moved to MCP_API_KEY_USAGE_STATS_PATH. Kept for one-time migration. */
  usageStats?: Record<string, ApiKeyUsageStats>;
  updatedAt: string;
}

interface PersistedUsageStats {
  usageStats: Record<string, ApiKeyUsageStats>;
  updatedAt: string;
}

export interface ApiKeyEntry {
  id: string;
  label: string;
  maskedPreview: string;
  source: KeySource;
  enabled: boolean;
  usageStats: ApiKeyUsageStats;
}

export interface ApiKeyPayload {
  keys: ApiKeyEntry[];
  selectionMode: SelectionMode;
  activeKeyId?: string;
  lockedByEnv: boolean;
  settingsPath: string;
  usageStatsPath: string;
  totalCount: number;
  enabledCount: number;
}

export interface ResolvedApiKey {
  id: string;
  label: string;
  rawKey: string;
}

const SETTINGS_PATH = path.resolve(
  process.cwd(),
  process.env.MCP_API_KEYS_PATH ?? ".media-mcp-api-keys.json"
);

const USAGE_STATS_PATH = path.resolve(
  process.cwd(),
  process.env.MCP_API_KEY_USAGE_STATS_PATH ?? ".media-mcp-api-key-usage.json"
);

function maskKey(key: string): string {
  if (key.length <= 8) {
    return `${key.slice(0, 4)}...`;
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function stableKeyId(source: KeySource, key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `${source}-${hash}`;
}

function normalizeUsageStats(stats?: ApiKeyUsageStats): ApiKeyUsageStats {
  return {
    total: stats?.total ?? 0,
    byModel: stats?.byModel ?? {},
    lastUsedAt: stats?.lastUsedAt
  };
}

function readPersistedSettings(): PersistedSettings | undefined {
  if (!existsSync(SETTINGS_PATH)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as PersistedSettings;
  } catch {
    return undefined;
  }
}

function writePersistedSettings(settings: PersistedSettings): void {
  mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function readPersistedUsageStats(): PersistedUsageStats | undefined {
  if (!existsSync(USAGE_STATS_PATH)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(USAGE_STATS_PATH, "utf8")) as PersistedUsageStats;
  } catch {
    return undefined;
  }
}

function writePersistedUsageStats(usageStats: Record<string, ApiKeyUsageStats>): void {
  mkdirSync(path.dirname(USAGE_STATS_PATH), { recursive: true });
  writeFileSync(
    USAGE_STATS_PATH,
    `${JSON.stringify({ usageStats, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

export class ApiKeyStore {
  readonly lockedByEnv: boolean;
  private keys: PersistedKey[] = [];
  private usageStats: Record<string, ApiKeyUsageStats> = {};
  private selectionMode: SelectionMode = "manual";
  private activeKeyId?: string;
  private roundRobinIndex = 0;

  constructor(envGoogleApiKeys: string[], envGoogleApiKey?: string) {
    const multiKeyEnv = envGoogleApiKeys.length > 0;
    this.lockedByEnv = multiKeyEnv;

    const envKeys = multiKeyEnv
      ? envGoogleApiKeys
      : (envGoogleApiKey ? [envGoogleApiKey] : []);

    const persisted = readPersistedSettings();
    const persistedUsage = readPersistedUsageStats();
    this.usageStats = persistedUsage?.usageStats ?? persisted?.usageStats ?? {};
    if (!persistedUsage && persisted?.usageStats) {
      writePersistedUsageStats(this.usageStats);
    }
    this.selectionMode = persisted?.selectionMode ?? "manual";
    this.activeKeyId = persisted?.activeKeyId;

    if (this.lockedByEnv) {
      this.keys = envKeys.map((key) => ({
        id: stableKeyId("env", key),
        label: `env-key-${key.slice(0, 6)}`,
        rawKey: key,
        source: "env" as KeySource,
        enabled: true
      }));
      if (!this.activeKeyId || !this.keys.find((k) => k.id === this.activeKeyId)) {
        this.activeKeyId = this.keys[0]?.id;
      }
    } else {
      this.keys = persisted?.keys.filter((k) => k.source === "ui") ?? [];
      if (envGoogleApiKey) {
        const existingEnv = this.keys.find(
          (k) => k.source === "env" && k.rawKey === envGoogleApiKey
        );
        if (!existingEnv) {
          this.keys.unshift({
            id: stableKeyId("env", envGoogleApiKey),
            label: `env-key-${envGoogleApiKey.slice(0, 6)}`,
            rawKey: envGoogleApiKey,
            source: "env",
            enabled: true
          });
        }
      }
      if (this.activeKeyId && !this.keys.find((k) => k.id === this.activeKeyId)) {
        this.activeKeyId = this.keys.find((k) => k.enabled)?.id;
      }
      if (!this.activeKeyId) {
        this.activeKeyId = this.keys.find((k) => k.enabled)?.id;
      }
    }
  }

  getPayload(): ApiKeyPayload {
    const enabledKeys = this.keys.filter((k) => k.enabled);
    return {
      keys: this.keys.map((k) => ({
        id: k.id,
        label: k.label,
        maskedPreview: maskKey(k.rawKey),
        source: k.source,
        enabled: k.enabled,
        usageStats: normalizeUsageStats(this.usageStats[k.id])
      })),
      selectionMode: this.selectionMode,
      activeKeyId: this.activeKeyId,
      lockedByEnv: this.lockedByEnv,
      settingsPath: SETTINGS_PATH,
      usageStatsPath: USAGE_STATS_PATH,
      totalCount: this.keys.length,
      enabledCount: enabledKeys.length
    };
  }

  resolveApiKey(): ResolvedApiKey {
    const enabled = this.keys.filter((k) => k.enabled);
    if (enabled.length === 0) {
      throw new Error("No enabled Google API keys configured.");
    }

    if (this.selectionMode === "round-robin") {
      const key = enabled[this.roundRobinIndex % enabled.length];
      this.roundRobinIndex = (this.roundRobinIndex + 1) % enabled.length;
      return {
        id: key.id,
        label: key.label,
        rawKey: key.rawKey
      };
    }

    const selected = enabled.find((k) => k.id === this.activeKeyId) ?? enabled[0];
    return {
      id: selected.id,
      label: selected.label,
      rawKey: selected.rawKey
    };
  }

  recordUsage(keyId: string, model: string): ApiKeyUsageStats {
    const current = normalizeUsageStats(this.usageStats[keyId]);
    const next = {
      total: current.total + 1,
      byModel: {
        ...current.byModel,
        [model]: (current.byModel[model] ?? 0) + 1
      },
      lastUsedAt: new Date().toISOString()
    };
    this.usageStats[keyId] = next;
    this.persistUsageStats();
    return next;
  }

  hasKey(): boolean {
    return this.keys.some((k) => k.enabled);
  }

  saveSettings(
    keys: Array<{ id?: string; label: string; rawKey?: string; enabled: boolean }>,
    selectionMode: SelectionMode,
    activeKeyId?: string
  ): void {
    if (this.lockedByEnv) {
      throw new Error("API key settings are locked by GOOGLE_API_KEYS env var.");
    }

    const envKeys = this.keys.filter((k) => k.source === "env");
    const uiKeys: PersistedKey[] = keys.map((k) => {
        const existing = k.id ? this.keys.find((ek) => ek.id === k.id) : undefined;
        const rawKey = k.rawKey ?? existing?.rawKey;
        if (!rawKey) {
          throw new Error(`Missing raw key for ${k.label}.`);
        }
        return {
          id: k.id ?? randomUUID(),
          label: k.label,
          rawKey,
          source: "ui" as KeySource,
          enabled: k.enabled
        };
      });

    this.keys = [...envKeys, ...uiKeys];
    this.selectionMode = selectionMode;
    this.activeKeyId = activeKeyId;
    this.roundRobinIndex = 0;

    writePersistedSettings({
      keys: uiKeys,
      selectionMode: this.selectionMode,
      activeKeyId: this.activeKeyId,
      updatedAt: new Date().toISOString()
    });
    this.persistUsageStats();
  }

  reload(): void {
    const persisted = readPersistedSettings();
    if (!persisted) {
      return;
    }
    const envKeys = this.keys.filter((k) => k.source === "env");
    this.keys = [...envKeys, ...persisted.keys.filter((k) => k.source === "ui")];
    this.usageStats = readPersistedUsageStats()?.usageStats ?? persisted.usageStats ?? {};
    this.selectionMode = persisted.selectionMode;
    this.activeKeyId = persisted.activeKeyId;
    this.roundRobinIndex = 0;
  }

  private persistUsageStats(): void {
    writePersistedUsageStats(this.usageStats);
  }
}
