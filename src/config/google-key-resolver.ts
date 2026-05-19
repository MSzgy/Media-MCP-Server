import { ApiKeyStore, ResolvedApiKey } from "./api-keys-store.js";

export interface GoogleKeyResolver {
  resolveApiKey(): ResolvedApiKey;
  recordUsage(keyId: string, model: string): void;
  hasKey(): boolean;
}

export class DefaultGoogleKeyResolver implements GoogleKeyResolver {
  constructor(private readonly store: ApiKeyStore) {}

  hasKey(): boolean {
    return this.store.hasKey();
  }

  resolveApiKey(): ResolvedApiKey {
    return this.store.resolveApiKey();
  }

  recordUsage(keyId: string, model: string): void {
    this.store.recordUsage(keyId, model);
  }
}
