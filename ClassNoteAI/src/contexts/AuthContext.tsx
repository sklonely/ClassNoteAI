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

    const login = async (username: string) => {
        return authService.login(username);
    };

    const register = async (username: string) => {
        return authService.register(username);
    };

    /**
     * Logout: clears the auth principal AND any user-scoped in-memory
     * / on-disk state that must not survive a user switch.
     *
     * Phase 7 R-1 (Sprint 1): tear down the recording session singleton
     * (so a stale recorder/mic stream doesn't carry into the next
     * login) and wipe stored API keys. Errors from each step are
     * swallowed independently — partial cleanup beats refusing to log
     * out at all.
     *
     * TODO Sprint 2 R-1: also call taskTrackerService.cancelAll() once
     * that service lands; cancelling pending background tasks is the
     * remaining piece of the R-1 sweep.
     */
    const logout = async () => {
        // Existing: clear auth principal. Wrap in try/catch — partial
        // cleanup is better than refusing to log out at all (e.g. if
        // localStorage write throws under quota / private mode).
        try {
            authService.logout();
        } catch (err) {
            console.warn('[AuthContext.logout] authService.logout failed', err);
        }

        // R-1: reset recording singleton — bypasses the stop pipeline,
        // which is the right call here because the user is leaving the
        // session entirely.
        try {
            recordingSessionService.reset();
        } catch (err) {
            console.warn('[AuthContext.logout] recording reset failed', err);
        }

        // R-1: wipe API keys so the next user can't read them.
        try {
            await clearAllKeys();
        } catch (err) {
            console.warn('[AuthContext.logout] keyStore clear failed', err);
        }

        // R-1 (cp75): cancel any in-flight background tasks (summarize /
        // index / export). taskTrackerService landed in Sprint 2 cp72.0;
        // this completes the R-1 sweep that the Sprint 1 TODO promised.
        try {
            taskTrackerService.cancelAll();
        } catch (err) {
            console.warn('[AuthContext.logout] taskTracker cancelAll failed', err);
        }

        // cp75.3: drop the inbox-state in-memory cache so the next read
        // hits localStorage under the new user's scoped key. Without this
        // the previous user's snooze/done state would persist in `cache`
        // until a page reload.
        try {
            const { __resetInboxCache } = await import(
                '../services/inboxStateService'
            );
            __resetInboxCache();
        } catch (err) {
            console.warn('[AuthContext.logout] inbox cache reset failed', err);
        }
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
