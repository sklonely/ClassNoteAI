/**
 * Credential storage for LLM providers.
 *
 * Uses localStorage, namespaced under `llm.<providerId>.<field>`. In a
 * Tauri desktop app the localStorage is per-webview and isolated to the
 * app directory, so the threat model is "protect against casual
 * filesystem snooping", not "defend against a local attacker with disk
 * access." A future PR can migrate hot providers to an OS keychain.
 */

const PREFIX = 'llm.';

export interface KeyStore {
  get(providerId: string, field: string): string | null;
  set(providerId: string, field: string, value: string): void;
  clear(providerId: string, field: string): void;
  has(providerId: string, field: string): boolean;
}

function keyOf(providerId: string, field: string): string {
  return `${PREFIX}${providerId}.${field}`;
}

class LocalStorageKeyStore implements KeyStore {
  get(providerId: string, field: string): string | null {
    return localStorage.getItem(keyOf(providerId, field));
  }
  set(providerId: string, field: string, value: string): void {
    localStorage.setItem(keyOf(providerId, field), value);
  }
  clear(providerId: string, field: string): void {
    localStorage.removeItem(keyOf(providerId, field));
  }
  has(providerId: string, field: string): boolean {
    return localStorage.getItem(keyOf(providerId, field)) !== null;
  }
}

export const keyStore: KeyStore = new LocalStorageKeyStore();
