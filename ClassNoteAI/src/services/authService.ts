import { invoke } from "@tauri-apps/api/core";
import { offlineQueueService } from './offlineQueueService';

export interface User {
    username: string;
    isVerified: boolean; // True if confirmed by server
    last_login?: string;
    created_at?: string;
}

const STORAGE_KEY_USER = 'classnote_current_user';

class AuthService {
    private currentUser: User | null = null;
    private listeners: ((user: User | null) => void)[] = [];

    constructor() {
        this.loadUser();
        this.registerProcessors();
    }

    private registerProcessors(): void {
        // Register AUTH_REGISTER processor
        offlineQueueService.registerProcessor('AUTH_REGISTER', async (payload) => {
            await this.registerOnServer(payload.serverUrl, payload.username);
        });
    }

    private async registerOnServer(serverUrl: string, username: string): Promise<void> {
        // Use Tauri plugin-http fetch to bypass macOS ATS restrictions
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        const response = await tauriFetch(`${serverUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        } as any);

        if (response.ok) {
            // Update user as verified
            if (this.currentUser && this.currentUser.username === username) {
                this.currentUser.isVerified = true;
                this.saveUser(this.currentUser);
            }
            console.log('[AuthService] Server registration successful');
        } else if (response.status === 409) {
            console.warn('[AuthService] Username conflict on server');
            throw new Error('Username conflict');
        } else {
            throw new Error(`Registration failed: ${response.status}`);
        }
    }

    public subscribe(listener: (user: User | null) => void): () => void {
        this.listeners.push(listener);
        listener(this.currentUser);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(l => l(this.currentUser));
    }

    private loadUser() {
        const stored = localStorage.getItem(STORAGE_KEY_USER);
        if (stored) {
            this.currentUser = JSON.parse(stored);
        }
    }

    private saveUser(user: User | null) {
        if (user) {
            localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
        } else {
            localStorage.removeItem(STORAGE_KEY_USER);
        }
        this.currentUser = user;
        this.notifyListeners();
    }

    public getUser(): User | null {
        return this.currentUser;
    }

    public async register(username: string, serverUrl?: string): Promise<void> {
        // 1. Local Registration
        try {
            await invoke('register_local_user', { username });
        } catch (error) {
            console.error('Local registration failed:', error);
        }

        const user: User = { username, isVerified: false };
        this.saveUser(user);

        // 2. Queue Server Sync (if serverUrl provided)
        if (serverUrl) {
            await offlineQueueService.enqueue('AUTH_REGISTER', { serverUrl, username });
        }
    }

    public async login(username: string): Promise<boolean> {
        try {
            const isValid = await invoke('check_local_user', { username });
            if (isValid) {
                const user: User = { username, isVerified: false };
                this.saveUser(user);
                return true;
            }
        } catch (e) {
            console.error(e);
        }
        return false;
    }

    public async setCurrentUser(username: string) {
        this.saveUser({ username, isVerified: false });
    }

    public logout() {
        this.saveUser(null);
    }

    // Manual verification (called when user explicitly wants to sync)
    public async syncUserVerify(serverUrl: string): Promise<boolean> {
        if (!this.currentUser) return false;
        if (this.currentUser.isVerified) return true;

        await offlineQueueService.enqueue('AUTH_REGISTER', {
            serverUrl,
            username: this.currentUser.username
        });
        return true;
    }
}

export const authService = new AuthService();
