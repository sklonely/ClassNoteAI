/**
 * Phase 1 of speech-pipeline-v0.6.5 (#52). Watches the device battery
 * and emits two escalating signals while a recording is in progress:
 *
 *   - `low`  (≤ 10% AND not charging)  → toast warning so the user can
 *     plug in or wrap up the lecture before the crash window opens.
 *
 *   - `critical` (≤ 5% AND not charging) → fires the registered
 *     `onCritical` handler so the recorder can flush + auto-stop while
 *     the JSONL sidecar still has time to land. Issuing a forced stop
 *     here is strictly better than letting the OS yank the process and
 *     forcing the user through the recovery flow next launch.
 *
 * The thresholds match #52 ("< 10% warn, < 5% auto-stop"). The hooks
 * are coarse (`once-per-threshold-crossing`, no spam) because polling
 * here is intentionally driven by browser battery events rather than
 * a setInterval.
 *
 * Tauri webviews expose the same `navigator.getBattery()` shim Web
 * gives us. On platforms where the API is missing entirely (some
 * Linux configurations) this service degrades silently — the rest of
 * the recording flow keeps working, just without battery guards.
 */

import { toastService } from './toastService';

export type BatteryThreshold = 'normal' | 'low' | 'critical';

interface BatteryLikeManager extends EventTarget {
  level: number;
  charging: boolean;
}

export interface BatteryMonitorOptions {
  /** Called once when battery first crosses the critical threshold
   *  (level ≤ 0.05 AND not charging). The recorder should flush and
   *  stop. Promise rejection is logged but doesn't re-trigger. */
  onCritical?: () => void | Promise<void>;
  /** Override the warning threshold for tests. Defaults to 0.10. */
  lowAt?: number;
  /** Override the critical threshold for tests. Defaults to 0.05. */
  criticalAt?: number;
  /** Replace `navigator.getBattery` for tests. */
  getBattery?: () => Promise<BatteryLikeManager>;
}

type ListenerWrapper = {
  type: 'levelchange' | 'chargingchange';
  fn: (e: Event) => void;
};

export class BatteryMonitor {
  private mgr: BatteryLikeManager | null = null;
  private threshold: BatteryThreshold = 'normal';
  private listeners: ListenerWrapper[] = [];
  private opts: Required<Omit<BatteryMonitorOptions, 'onCritical' | 'getBattery'>> &
    Pick<BatteryMonitorOptions, 'onCritical' | 'getBattery'>;
  private active = false;

  constructor(options: BatteryMonitorOptions = {}) {
    this.opts = {
      lowAt: options.lowAt ?? 0.1,
      criticalAt: options.criticalAt ?? 0.05,
      onCritical: options.onCritical,
      getBattery: options.getBattery,
    };
  }

  /** Resolve the current threshold given level + charging state.
   *  Pure helper, exposed for unit tests. */
  static deriveThreshold(level: number, charging: boolean, lowAt: number, criticalAt: number): BatteryThreshold {
    if (charging) return 'normal';
    if (level <= criticalAt) return 'critical';
    if (level <= lowAt) return 'low';
    return 'normal';
  }

  /** Begin watching. Idempotent. Safe to call before user grants any
   *  permission — `navigator.getBattery` is permission-free in browsers
   *  that still ship it. Returns false if the platform has no battery
   *  API at all (caller can decide whether to surface that to the user). */
  async start(): Promise<boolean> {
    if (this.active) return true;
    const getBattery = this.opts.getBattery ?? this.resolveNavigatorGetBattery();
    if (!getBattery) {
      console.info('[BatteryMonitor] navigator.getBattery() unavailable — skipping');
      return false;
    }
    try {
      this.mgr = await getBattery();
    } catch (err) {
      console.warn('[BatteryMonitor] getBattery() rejected:', err);
      return false;
    }

    const recheck = () => this.recompute();
    const wrappers: ListenerWrapper[] = [
      { type: 'levelchange', fn: recheck },
      { type: 'chargingchange', fn: recheck },
    ];
    for (const w of wrappers) this.mgr.addEventListener(w.type, w.fn);
    this.listeners = wrappers;

    this.active = true;
    this.recompute(); // seed initial state
    return true;
  }

  stop(): void {
    if (!this.active) return;
    if (this.mgr) {
      for (const w of this.listeners) {
        this.mgr.removeEventListener(w.type, w.fn);
      }
    }
    this.listeners = [];
    this.mgr = null;
    this.threshold = 'normal';
    this.active = false;
  }

  /** Force the monitor through one evaluation pass. Tests use this to
   *  drive the state machine deterministically. */
  recompute(): BatteryThreshold {
    if (!this.mgr) return 'normal';
    const next = BatteryMonitor.deriveThreshold(
      this.mgr.level,
      this.mgr.charging,
      this.opts.lowAt,
      this.opts.criticalAt,
    );
    if (next === this.threshold) return next;

    const previous = this.threshold;
    this.threshold = next;

    // Fire side effects only on UPGRADE (normal → low → critical). A
    // downgrade (e.g. plug in laptop) silently drops back to normal.
    const upgraded =
      (previous === 'normal' && next !== 'normal') ||
      (previous === 'low' && next === 'critical');

    if (!upgraded) return next;

    if (next === 'low') {
      toastService.show({
        type: 'warning',
        message: '電量偏低',
        detail: `電量低於 ${Math.round(this.opts.lowAt * 100)}%。建議插上電源，或盡早結束這堂課的錄音。`,
        durationMs: 0, // pin until dismissed; user needs to see this
      });
    } else if (next === 'critical') {
      toastService.show({
        type: 'error',
        message: '電量危急，自動停止錄音',
        detail: `電量 ≤ ${Math.round(this.opts.criticalAt * 100)}%，已自動停止以保留目前的音訊與字幕。`,
        durationMs: 0,
      });
      if (this.opts.onCritical) {
        try {
          const r = this.opts.onCritical();
          if (r && typeof (r as Promise<void>).catch === 'function') {
            (r as Promise<void>).catch((err) =>
              console.error('[BatteryMonitor] onCritical handler threw:', err),
            );
          }
        } catch (err) {
          console.error('[BatteryMonitor] onCritical handler threw:', err);
        }
      }
    }
    return next;
  }

  /** Inspect the current threshold without forcing recompute. Tests. */
  currentThreshold(): BatteryThreshold {
    return this.threshold;
  }

  /** Dynamic-resolution shim: keeps tests free of `any`-cast on
   *  navigator and lets us return undefined without throwing on
   *  platforms (e.g. some Firefox builds) that removed the API. */
  private resolveNavigatorGetBattery(): (() => Promise<BatteryLikeManager>) | null {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & {
      getBattery?: () => Promise<BatteryLikeManager>;
    }) : null;
    if (!nav || typeof nav.getBattery !== 'function') return null;
    return () => nav.getBattery!();
  }
}
