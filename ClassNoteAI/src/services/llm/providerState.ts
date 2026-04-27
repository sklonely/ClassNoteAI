import { storageService } from '../storageService';

export const DEFAULT_PROVIDER_KEY = 'llm.defaultProvider';

export function readPreferredProviderFromLocalStorage(): string | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  return localStorage.getItem(DEFAULT_PROVIDER_KEY) || undefined;
}

export async function readPreferredProviderId(): Promise<string | undefined> {
  const shared = await storageService.getSetting(DEFAULT_PROVIDER_KEY).catch(() => null);
  if (shared) return shared;

  const legacy = readPreferredProviderFromLocalStorage();
  if (legacy) {
    await storageService.saveSetting(DEFAULT_PROVIDER_KEY, legacy).catch(() => undefined);
  }
  return legacy;
}

export async function writePreferredProviderId(providerId: string | null): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    if (providerId) {
      localStorage.setItem(DEFAULT_PROVIDER_KEY, providerId);
    } else {
      localStorage.removeItem(DEFAULT_PROVIDER_KEY);
    }
  }

  if (providerId) {
    await storageService.saveSetting(DEFAULT_PROVIDER_KEY, providerId);
  } else {
    await storageService.saveSetting(DEFAULT_PROVIDER_KEY, '');
  }
}
