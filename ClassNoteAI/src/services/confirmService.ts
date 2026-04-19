/**
 * Themed confirm dialog, as a promise-returning service mirroring the
 * native `window.confirm` shape. Native `confirm` broke the app's
 * dark/purple design system (it's an OS-chrome popup with a white
 * background and system font), so we replace every call site with
 *
 *   await confirmService.ask({ title, message, confirmLabel, variant })
 *
 * that resolves to `true` when the user hits 「確定」 / `false` on
 * Cancel or Escape.
 *
 * Backed by the same subscriber pattern `toastService` uses — the
 * mounted `ConfirmDialog` component subscribes on mount, unmounts
 * rendering when there's no active request, and imperatively calls
 * `accept()` / `dismiss()` to resolve the waiting promise.
 */

export type ConfirmVariant = 'default' | 'danger';

export interface ConfirmRequest {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: ConfirmVariant;
}

interface ActiveRequest extends ConfirmRequest {
    id: number;
    resolve: (v: boolean) => void;
}

type Listener = (active: ActiveRequest | null) => void;

class ConfirmService {
    private active: ActiveRequest | null = null;
    private listeners = new Set<Listener>();
    private nextId = 1;

    /** Opens a themed confirm dialog. Returns `true` if the user
     *  confirmed, `false` on cancel / Escape / backdrop-click. */
    ask(req: ConfirmRequest): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            // If a previous request is still pending (shouldn't happen
            // in practice — callers await before firing another) we
            // resolve the older one as false so no promise is leaked.
            if (this.active) this.active.resolve(false);
            this.active = { ...req, id: this.nextId++, resolve };
            this.emit();
        });
    }

    accept() {
        if (!this.active) return;
        const r = this.active;
        this.active = null;
        this.emit();
        r.resolve(true);
    }

    dismiss() {
        if (!this.active) return;
        const r = this.active;
        this.active = null;
        this.emit();
        r.resolve(false);
    }

    current(): ActiveRequest | null {
        return this.active;
    }

    subscribe(cb: Listener): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    private emit() {
        for (const l of this.listeners) {
            try {
                l(this.active);
            } catch (err) {
                console.warn('[confirmService] listener threw:', err);
            }
        }
    }
}

export const confirmService = new ConfirmService();
