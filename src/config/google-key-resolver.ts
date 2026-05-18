import { ApiKeyStore } from "./api-keys-store.js";

export interface GoogleKeyResolver {
  resolveApiKey(): string;
  hasKey(): boolean;
}

export class DefaultGoogleKeyResolver implements GoogleKeyResolver {
  constructor(private readonly store: ApiKeyStore) {}

  hasKey(): boolean {
    return this.store.hasKey();
  }

  resolveApiKey(): string {
    return this.store.resolveApiKey();
  }
}
