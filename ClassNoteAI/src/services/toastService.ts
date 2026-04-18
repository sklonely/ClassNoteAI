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
    };
    this.toasts = [...this.toasts, toast];
    this.notify();

    if (duration > 0) {
      const timer = setTimeout(() => this.dismiss(toast.id), duration);
      this.timers.set(toast.id, timer);
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
    this.notify();
  }

  /** Clear everything. Test helper; nothing in the app calls it today. */
  clear() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.toasts = [];
    this.notify();
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
