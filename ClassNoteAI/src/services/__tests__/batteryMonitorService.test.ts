/**
 * Phase 1 of speech-pipeline-v0.6.5 (#52). The battery monitor's job
 * is to fire at most one toast per threshold-cross AND fire the
 * critical handler exactly once when level hits ≤ 5% off-charger.
 * Both invariants are easy to break with naive event listeners (cf.
 * a level oscillating around the threshold), so they are pinned by
 * test rather than by code review.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatteryMonitor } from '../batteryMonitorService';

vi.mock('../toastService', () => ({
  toastService: {
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { toastService } from '../toastService';

class FakeBattery extends EventTarget {
  level: number;
  charging: boolean;
  constructor(level: number, charging: boolean) {
    super();
    this.level = level;
    this.charging = charging;
  }
  setLevel(next: number) {
    this.level = next;
    this.dispatchEvent(new Event('levelchange'));
  }
  setCharging(next: boolean) {
    this.charging = next;
    this.dispatchEvent(new Event('chargingchange'));
  }
}

beforeEach(() => {
  vi.mocked(toastService.show).mockClear();
});

describe('BatteryMonitor.deriveThreshold', () => {
  it('returns "normal" when on charger regardless of level', () => {
    expect(BatteryMonitor.deriveThreshold(0.01, true, 0.1, 0.05)).toBe('normal');
    expect(BatteryMonitor.deriveThreshold(0.5, true, 0.1, 0.05)).toBe('normal');
  });

  it('returns "critical" only when level <= criticalAt and discharging', () => {
    expect(BatteryMonitor.deriveThreshold(0.05, false, 0.1, 0.05)).toBe('critical');
    expect(BatteryMonitor.deriveThreshold(0.04, false, 0.1, 0.05)).toBe('critical');
  });

  it('returns "low" between thresholds when discharging', () => {
    expect(BatteryMonitor.deriveThreshold(0.10, false, 0.1, 0.05)).toBe('low');
    expect(BatteryMonitor.deriveThreshold(0.07, false, 0.1, 0.05)).toBe('low');
  });

  it('returns "normal" above the warning threshold', () => {
    expect(BatteryMonitor.deriveThreshold(0.5, false, 0.1, 0.05)).toBe('normal');
    expect(BatteryMonitor.deriveThreshold(0.11, false, 0.1, 0.05)).toBe('normal');
  });
});

describe('BatteryMonitor instance', () => {
  it('does NOT toast on start when battery is already healthy', async () => {
    const fake = new FakeBattery(0.8, false);
    const m = new BatteryMonitor({ getBattery: async () => fake });
    await m.start();
    expect(toastService.show).not.toHaveBeenCalled();
    expect(m.currentThreshold()).toBe('normal');
  });

  it('toasts a warning the first time battery crosses into low', async () => {
    const fake = new FakeBattery(0.5, false);
    const m = new BatteryMonitor({ getBattery: async () => fake });
    await m.start();
    fake.setLevel(0.09);
    expect(m.currentThreshold()).toBe('low');
    expect(toastService.show).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toastService.show).mock.calls[0][0].type).toBe('warning');
  });

  it('does not re-toast when battery stays low across multiple level events', async () => {
    const fake = new FakeBattery(0.09, false);
    const m = new BatteryMonitor({ getBattery: async () => fake });
    await m.start();
    fake.setLevel(0.085);
    fake.setLevel(0.08);
    fake.setLevel(0.075);
    // One toast for the initial seed crossing into low; the rest are
    // same-threshold updates that must NOT spam additional toasts.
    expect(toastService.show).toHaveBeenCalledTimes(1);
  });

  it('fires onCritical exactly once when crossing into critical', async () => {
    const onCritical = vi.fn();
    const fake = new FakeBattery(0.5, false);
    const m = new BatteryMonitor({ getBattery: async () => fake, onCritical });
    await m.start();
    fake.setLevel(0.04);
    expect(onCritical).toHaveBeenCalledTimes(1);

    // Further drops while already in critical must NOT re-fire — the
    // recorder has already been told to stop.
    fake.setLevel(0.03);
    fake.setLevel(0.02);
    expect(onCritical).toHaveBeenCalledTimes(1);
  });

  it('respects charging — plugging in after low never re-fires on next cross', async () => {
    const onCritical = vi.fn();
    const fake = new FakeBattery(0.08, false);
    const m = new BatteryMonitor({ getBattery: async () => fake, onCritical });
    await m.start();
    expect(toastService.show).toHaveBeenCalledTimes(1); // low warning seeded

    fake.setCharging(true); // plug in → drops back to normal silently
    expect(m.currentThreshold()).toBe('normal');

    fake.setCharging(false); // unplug at the same low level
    fake.setLevel(0.08);
    // Going from normal back to low IS a fresh cross, so a new warning is allowed.
    expect(toastService.show).toHaveBeenCalledTimes(2);
    expect(onCritical).not.toHaveBeenCalled();
  });

  it('returns false from start() if navigator has no battery API', async () => {
    const m = new BatteryMonitor({
      getBattery: undefined,
    });
    // No navigator.getBattery on jsdom by default — should degrade silently.
    const ok = await m.start();
    expect(ok).toBe(false);
  });

  it('returns false from start() if getBattery rejects', async () => {
    const m = new BatteryMonitor({
      getBattery: () => Promise.reject(new Error('denied')),
    });
    const ok = await m.start();
    expect(ok).toBe(false);
    expect(toastService.show).not.toHaveBeenCalled();
  });

  it('stop() unsubscribes from battery events so later changes are silent', async () => {
    const fake = new FakeBattery(0.5, false);
    const m = new BatteryMonitor({ getBattery: async () => fake });
    await m.start();
    m.stop();
    fake.setLevel(0.04);
    expect(toastService.show).not.toHaveBeenCalled();
  });

  it('escalates from low to critical with a separate toast each step', async () => {
    const onCritical = vi.fn();
    const fake = new FakeBattery(0.5, false);
    const m = new BatteryMonitor({ getBattery: async () => fake, onCritical });
    await m.start();
    fake.setLevel(0.09); // low
    fake.setLevel(0.04); // critical
    expect(toastService.show).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toastService.show).mock.calls[0][0].type).toBe('warning');
    expect(vi.mocked(toastService.show).mock.calls[1][0].type).toBe('error');
    expect(onCritical).toHaveBeenCalledTimes(1);
  });
});
