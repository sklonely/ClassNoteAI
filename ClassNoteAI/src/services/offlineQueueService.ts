import { invoke } from '@tauri-apps/api/core';

// cp75.34 — Avoid a top-level `import { authService } from './authService'`.
// authService.ts imports this module at module load (to register the
// AUTH_REGISTER processor). A static import here would either (a) break
// the cycle in jest/vitest (authService binding is undefined at the
// time `new AuthService()` runs, blowing up offlineQueueService.registerProcessor),
// or (b) under ESM with hoisting still hand us back an in-construction
// stub. Using a setter-injection seam keeps the module decoupled.
type AuthFacade = { getUser(): { username: string } | null };
let authFacade: AuthFacade | null = null;
export function _setAuthFacade(facade: AuthFacade | null): void {
    // TEST-ONLY hook (also used by authService at construction time).
    authFacade = facade;
}
function currentUserIdOrDefault(): string {
    return authFacade?.getUser()?.username || 'default_user';
}

export type ActionType =
    | 'AUTH_REGISTER'
    | 'PURGE_ITEM'
    | 'TASK_CREATE';

export interface PendingAction {
    id: string;
    actionType: ActionType;
    payload: string; // JSON stringified
    status: 'pending' | 'processing' | 'failed' | 'completed';
    retryCount: number;
}

type ActionProcessor = (payload: any) => Promise<void>;

class OfflineQueueService {
    private processors: Map<ActionType, ActionProcessor> = new Map();
    private isProcessing = false;
    private maxRetries = 3;
    private listeners: ((count: number) => void)[] = [];
    private initialized = false;

    constructor() {
        // Listen for online event
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                console.log('[OfflineQueue] Network online, processing queue...');
                this.processQueue();
            });
        }
    }

    /**
     * Initialize queue - clean up stuck 'processing' tasks from previous session
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;

        console.log('[OfflineQueue] Initializing, cleaning up stuck tasks...');
        const actions = await this.listActions();

        for (const action of actions) {
            if (action.status === 'processing') {
                // Reset to pending - was interrupted
                // cp75.34 — userId required for Rust-side defense-in-depth gate.
                await invoke('update_pending_action', {
                    id: action.id,
                    status: 'pending',
                    retryCount: action.retryCount,
                    userId: currentUserIdOrDefault()
                });
                console.log(`[OfflineQueue] Reset stuck task: ${action.actionType} (${action.id})`);
            }
        }

        // If online, process queue
        if (navigator.onLine) {
            this.processQueue();
        }
    }

    /**
     * Register a processor for a specific action type
     */
    registerProcessor(actionType: ActionType, processor: ActionProcessor): void {
        this.processors.set(actionType, processor);
    }

    /**
     * Subscribe to queue count changes
     */
    subscribe(listener: (count: number) => void): () => void {
        this.listeners.push(listener);
        this.notifyListeners();
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private async notifyListeners(): Promise<void> {
        const actions = await this.listActions();
        // Include processing status as it means work is in progress
        const count = actions.filter(a => a.status === 'pending' || a.status === 'failed' || a.status === 'processing').length;
        this.listeners.forEach(l => l(count));
    }

    /**
     * Add an action to the queue
     */
    async enqueue(actionType: ActionType, payload: any): Promise<string> {
        const id = crypto.randomUUID();
        const payloadStr = JSON.stringify(payload);

        // cp75.34 — userId required for Rust-side defense-in-depth gate.
        await invoke('add_pending_action', {
            id,
            actionType,
            payload: payloadStr,
            userId: currentUserIdOrDefault()
        });

        console.log(`[OfflineQueue] Enqueued: ${actionType} (${id})`);
        this.notifyListeners();

        // Try to process immediately if online
        if (navigator.onLine) {
            this.processQueue();
        }

        return id;
    }

    /**
     * List all pending actions
     */
    async listActions(): Promise<PendingAction[]> {
        const raw = await invoke<[string, string, string, string, number][]>('list_pending_actions');
        return raw.map(([id, actionType, payload, status, retryCount]) => ({
            id,
            actionType: actionType as ActionType,
            payload,
            status: status as PendingAction['status'],
            retryCount
        }));
    }

    /**
     * Process all pending actions in the queue
     */
    async processQueue(): Promise<void> {
        if (this.isProcessing) {
            console.log('[OfflineQueue] Already processing, skipping...');
            return;
        }

        if (!navigator.onLine) {
            console.log('[OfflineQueue] Offline, skipping...');
            return;
        }

        this.isProcessing = true;
        console.log('[OfflineQueue] Starting queue processing...');

        try {
            // Loop until no more pending items (to catch items added during processing)
            let hasMore = true;
            while (hasMore) {
                const actions = await this.listActions();
                const pendingActions = actions.filter(a => a.status === 'pending' || a.status === 'failed');

                if (pendingActions.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const action of pendingActions) {
                    const processor = this.processors.get(action.actionType);
                    if (!processor) {
                        console.warn(`[OfflineQueue] No processor for: ${action.actionType}`);
                        // Remove unhandled action to prevent infinite loop
                        await invoke('remove_pending_action', { id: action.id });
                        continue;
                    }

                    // Mark as processing
                    // cp75.34 — userId required for Rust-side gate.
                    await invoke('update_pending_action', {
                        id: action.id,
                        status: 'processing',
                        retryCount: action.retryCount,
                        userId: currentUserIdOrDefault()
                    });

                    try {
                        const payload = JSON.parse(action.payload);
                        await processor(payload);

                        // Success - remove from queue
                        await invoke('remove_pending_action', { id: action.id });
                        console.log(`[OfflineQueue] Completed: ${action.actionType} (${action.id})`);

                    } catch (error) {
                        console.error(`[OfflineQueue] Failed: ${action.actionType} (${action.id})`, error);

                        const newRetryCount = action.retryCount + 1;
                        // cp75.34 — userId required for Rust-side gate.
                        if (newRetryCount >= this.maxRetries) {
                            // Max retries reached, mark as failed permanently
                            await invoke('update_pending_action', {
                                id: action.id,
                                status: 'failed',
                                retryCount: newRetryCount,
                                userId: currentUserIdOrDefault()
                            });
                        } else {
                            // Reset to pending for retry
                            await invoke('update_pending_action', {
                                id: action.id,
                                status: 'pending',
                                retryCount: newRetryCount,
                                userId: currentUserIdOrDefault()
                            });

                            // Exponential backoff delay before next retry
                            const delay = Math.pow(2, newRetryCount) * 1000;
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    }
                }
            }
        } finally {
            this.isProcessing = false;
            this.notifyListeners();
            console.log('[OfflineQueue] Queue processing finished.');
        }
    }

    /**
     * Check if currently online
     */
    isOnline(): boolean {
        return typeof navigator !== 'undefined' && navigator.onLine;
    }
}

export const offlineQueueService = new OfflineQueueService();
