import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { consentService, CONSENT_REMINDER_VERSION } from '../consentService';

describe('consentService', () => {
  it('reports not acknowledged when app settings are absent', async () => {
    const state = await consentService.getRecordingConsentState();

    expect(state).toEqual({
      acknowledged: false,
      acknowledgedAt: undefined,
      version: CONSENT_REMINDER_VERSION,
    });
  });

  it('persists acknowledgement into app_settings', async () => {
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'get_setting') return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const at = '2026-04-20T20:00:00.000Z';
    await consentService.acknowledgeRecordingConsent(at);

    const saveCall = vi
      .mocked(invoke)
      .mock.calls.find(([command]) => command === 'save_setting');

    expect(saveCall).toBeTruthy();
    const payload = saveCall?.[1] as { key: string; value: string };
    expect(payload.key).toBe('app_settings');
    expect(JSON.parse(payload.value)).toMatchObject({
      recording: {
        consentAcknowledgedAt: at,
        consentReminderVersion: CONSENT_REMINDER_VERSION,
      },
    });
  });
});
