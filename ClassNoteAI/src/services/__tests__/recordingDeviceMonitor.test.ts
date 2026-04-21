import { describe, expect, it } from 'vitest';
import { buildDeviceChangeWarning } from '../recordingDeviceMonitor';

describe('recordingDeviceMonitor', () => {
  it('returns null when the device label did not change', () => {
    expect(
      buildDeviceChangeWarning(
        { label: 'MacBook Pro 麥克風', sampleRate: 48_000 },
        { label: 'MacBook Pro 麥克風', sampleRate: 48_000 },
      ),
    ).toBeNull();
  });

  it('warns when the input changed to a bluetooth-style mic', () => {
    const warning = buildDeviceChangeWarning(
      { label: 'MacBook Pro 麥克風', sampleRate: 48_000 },
      { label: 'AirPods Pro', sampleRate: 16_000 },
    );

    expect(warning).toBeTruthy();
    expect(warning?.message).toContain('錄音麥克風可能被切換了');
    expect(warning?.detail).toContain('AirPods Pro');
    expect(warning?.detail).toContain('16kHz');
  });
});
