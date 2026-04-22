import type { AppSettings } from '../types';
import { storageService } from './storageService';

const CONSENT_REMINDER_VERSION = 1;

export interface RecordingConsentState {
  acknowledged: boolean;
  acknowledgedAt?: string;
  version: number;
}

function mergeSettings(existing: AppSettings | null, patch: AppSettings['recording']): AppSettings {
  return {
    server: existing?.server ?? { url: 'http://localhost', port: 8080, enabled: false },
    audio: existing?.audio ?? { sample_rate: 16000, chunk_duration: 2 },
    subtitle: existing?.subtitle ?? {
      font_size: 18,
      font_color: '#FFFFFF',
      background_opacity: 0.8,
      position: 'bottom',
      display_mode: 'both',
    },
    theme: existing?.theme ?? 'light',
    models: existing?.models,
    translation: existing?.translation,
    ollama: existing?.ollama,
    ocr: existing?.ocr,
    aiTutor: existing?.aiTutor,
    lectureLayout: existing?.lectureLayout,
    recording: {
      ...existing?.recording,
      ...patch,
    },
  };
}

class ConsentService {
  async getRecordingConsentState(): Promise<RecordingConsentState> {
    const settings = await storageService.getAppSettings();
    const version = settings?.recording?.consentReminderVersion ?? 0;
    const acknowledgedAt = settings?.recording?.consentAcknowledgedAt;
    return {
      acknowledged: Boolean(acknowledgedAt) && version >= CONSENT_REMINDER_VERSION,
      acknowledgedAt: acknowledgedAt ?? undefined,
      version: CONSENT_REMINDER_VERSION,
    };
  }

  async acknowledgeRecordingConsent(at = new Date().toISOString()): Promise<RecordingConsentState> {
    const existing = await storageService.getAppSettings();
    const next = mergeSettings(existing, {
      consentAcknowledgedAt: at,
      consentReminderVersion: CONSENT_REMINDER_VERSION,
    });
    await storageService.saveAppSettings(next);
    return {
      acknowledged: true,
      acknowledgedAt: at,
      version: CONSENT_REMINDER_VERSION,
    };
  }
}

export const consentService = new ConsentService();
export { CONSENT_REMINDER_VERSION };
