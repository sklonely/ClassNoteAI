/**
 * Tiny pub/sub toast manager for ephemeral, non-blocking notifications.
 *
 * Replaces scattered `alert()` calls throughout the app. `alert` is
 * modal (blocks the entire UI thread until dismissed) and breaks flow
 * for messages that are purely informational — "Summary generated
 * successfully!" should not require the user to stop, read, click OK,
 * then resume whatever they were doing.
 *
 * Design is deliberately spartan:
 *   - No React context / no hooks inside services.
 *   - Subscribers receive the full current list on every change, so
 *     the container component can render with a simple useState.
 *   - Auto-dismiss via internal timers; manual dismiss clears the
 *     timer.
 *
 * Callers: `toastService.show({ message, type?, durationMs? })`. Four
 *   types (success / error / info / warning) map to icons + colours
 *   in the ToastContainer component. `durationMs` defaults to 4500 for
 *   success/info, 8000 for error/warning (errors deserve a longer
 *   look). Passing 0 pins the toast until the user clicks dismiss.
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  /** When the toast appeared (ms since epoch). Used for stable sort. */
  at: number;
  /** Optional sub-line shown in smaller font under the main message. */
  detail?: string;
  /** v0.7.0: 實際排程的 duration (含 default 處理)。0 = sticky。
   *  H18 新 ToastContainer 用此值畫底部 countdown bar。 */
  durationMs: number;
}

export interface ShowToastOptions {
  message: string;
  type?: ToastType;
  /** 0 = no auto-dismiss, user must click to close. */
  durationMs?: number;
  detail?: string;
}

type Listener = (toasts: Toast[]) => void;

class ToastService {
  private toasts: Toast[] = [];
  private listeners = new Set<Listener>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** v0.7.0: epoch ms when each toast 應該被 auto-dismiss。
   *  pauseAll 時 clear timer 但保留此值；resumeAll 用 (expiresAt - now)
   *  算 remaining time 重新 setTimeout。Sticky (durationMs=0) 不放入。 */
  private expiresAt = new Map<number, number>();
  private isPaused = false;
  private nextId = 1;

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    // Push the current state immediately so a late-mounting subscriber
    // doesn't miss a toast that fired during its setup.
    cb(this.toasts.slice());
    return () => {
      this.listeners.delete(cb);
    };
  }

  show(opts: ShowToastOptions): number {
    const type = opts.type ?? 'info';
    // 2s for informational, 5s for errors/warnings (users need a
    // beat longer to read what went wrong). Callers can override via
    // `durationMs` and use 0 to pin.
    const defaultDuration = type === 'error' || type === 'warning' ? 5_000 : 2_000;
    const duration = opts.durationMs ?? defaultDuration;

    const toast: Toast = {
      id: this.nextId++,
      message: opts.message,
      type,
      at: Date.now(),
      detail: opts.detail,
      durationMs: duration,
    };
    this.toasts = [...this.toasts, toast];
    this.notify();

    if (duration > 0) {
      this.expiresAt.set(toast.id, Date.now() + duration);
      if (!this.isPaused) {
        const timer = setTimeout(() => this.dismiss(toast.id), duration);
        this.timers.set(toast.id, timer);
      }
    }
    return toast.id;
  }

  /** Convenience shorthands — saves 20 chars at every call-site. */
  success(message: string, detail?: string) {
    return this.show({ message, type: 'success', detail });
  }
  error(message: string, detail?: string) {
    return this.show({ message, type: 'error', detail });
  }
  info(message: string, detail?: string) {
    return this.show({ message, type: 'info', detail });
  }
  warning(message: string, detail?: string) {
    return this.show({ message, type: 'warning', detail });
  }

  dismiss(id: number) {
    const before = this.toasts.length;
    this.toasts = this.toasts.filter((t) => t.id !== id);
    if (this.toasts.length === before) return;
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.expiresAt.delete(id);
    this.notify();
  }

  /** Clear everything. Test helper; nothing in the app calls it today. */
  clear() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.expiresAt.clear();
    this.isPaused = false;
    this.toasts = [];
    this.notify();
  }

  /**
   * v0.7.0 — 暫停所有 toast 的 auto-dismiss timer。typically called by
   * H18 ToastContainer 在 onMouseEnter 時。expiresAt 保留以利 resume
   * 時算 remaining time。Idempotent (pauseAll 多次無 side effect)。
   */
  pauseAll() {
    if (this.isPaused) return;
    this.isPaused = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /**
   * v0.7.0 — 恢復 auto-dismiss timer。重新 setTimeout 用 max(800,
   * expiresAt - now) 作 remaining (避免使用者剛 hover 出去 toast 立刻
   * 消失，給 800ms grace)。Sticky toasts (durationMs=0, 不在 expiresAt
   * 內) 不會被 re-schedule。
   */
  resumeAll() {
    if (!this.isPaused) return;
    this.isPaused = false;
    const now = Date.now();
    for (const [id, expires] of this.expiresAt.entries()) {
      const remaining = Math.max(800, expires - now);
      const timer = setTimeout(() => this.dismiss(id), remaining);
      this.timers.set(id, timer);
    }
  }

  private notify() {
    const snapshot = this.toasts.slice();
    for (const l of this.listeners) {
      try {
        l(snapshot);
      } catch (err) {
        console.warn('[toastService] listener threw:', err);
      }
    }
  }
}

export const toastService = new ToastService();
