import React, { createContext, useContext, useEffect, useState } from 'react';
import { authService, User } from '../services/authService';
import { recordingSessionService } from '../services/recordingSessionService';
import { taskTrackerService } from '../services/taskTrackerService';
import { clearAll as clearAllKeys } from '../services/llm/keyStore';

interface AuthContextType {
    user: User | null;
    login: (username: string) => Promise<boolean>;
    register: (username: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(authService.getUser());

    useEffect(() => {
        const unsubscribe = authService.subscribe((u) => {
            setUser(u);
        });
        return unsubscribe;
    }, []);

    /**
     * cp75.4 — Shared cleanup sweep. Both `logout()` and `login()` call
     * this so switching users doesn't carry singletons / API keys / inbox
     * cache from the previous account into the next one.
     *
     * Steps (each wrapped in independent try/catch so partial failure
     * doesn't block the auth transition):
     *  1. recordingSessionService.reset() — bypass stop pipeline
     *  2. taskTrackerService.cancelAll() — drop in-flight LLM tasks
     *  3. clearAllKeys() — wipe llm.* API keys
     *  4. __resetInboxCache() — drop in-memory snooze/done state
     *
     * Phase 7 R-1 (Sprint 1) originally only ran on logout. Cp75.4 audit
     * caught: `setCurrentUser()` (used by cross-device sync) and direct
     * `login()` calls were skipping all four steps, so the second user
     * inherited keymapService overrides, keystore content (until clearAll),
     * recording session, and the inbox cache from the first user.
     */
    const resetUserScopedState = async (label: string) => {
        try {
            recordingSessionService.reset();
        } catch (err) {
            console.warn(`[AuthContext.${label}] recording reset failed`, err);
        }
        try {
            taskTrackerService.cancelAll();
        } catch (err) {
            console.warn(`[AuthContext.${label}] taskTracker cancelAll failed`, err);
        }
        try {
            await clearAllKeys();
        } catch (err) {
            console.warn(`[AuthContext.${label}] keyStore clear failed`, err);
        }
        try {
            const { __resetInboxCache } = await import(
                '../services/inboxStateService'
            );
            __resetInboxCache();
        } catch (err) {
            console.warn(`[AuthContext.${label}] inbox cache reset failed`, err);
        }
    };

    const login = async (username: string) => {
        // cp75.4: clear out any state left by a previous account before
        // attaching the new user (covers the no-explicit-logout flow,
        // e.g. switching users via UI without the logout button).
        await resetUserScopedState('login');
        return authService.login(username);
    };

    const register = async (username: string) => {
        return authService.register(username);
    };

    const logout = async () => {
        // Existing: clear auth principal. Wrap in try/catch — partial
        // cleanup is better than refusing to log out at all (e.g. if
        // localStorage write throws under quota / private mode).
        try {
            authService.logout();
        } catch (err) {
            console.warn('[AuthContext.logout] authService.logout failed', err);
        }
        await resetUserScopedState('logout');
    };

    return (
        <AuthContext.Provider value={{ user, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
