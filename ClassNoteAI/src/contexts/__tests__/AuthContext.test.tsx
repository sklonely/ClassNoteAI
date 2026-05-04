/**
 * AuthContext tests · Phase 7 Sprint 1 R-1
 *
 * The R-1 contract: logout() must
 *   1. clear the auth principal (existing behavior)
 *   2. tear down the recording session singleton
 *   3. wipe every stored API key
 * and must not throw if any of (2)/(3) fail — partial cleanup beats
 * refusing to log out at all.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import { authService } from '../../services/authService';
import { recordingSessionService } from '../../services/recordingSessionService';
import { keyStore } from '../../services/llm/keyStore';

// Tiny consumer that captures the auth context so the test can call
// logout() outside the React render cycle.
function captureAuth(holder: { current: ReturnType<typeof useAuth> | null }) {
    const Inner: React.FC = () => {
        holder.current = useAuth();
        return null;
    };
    return Inner;
}

function mountAuth() {
    const holder: { current: ReturnType<typeof useAuth> | null } = {
        current: null,
    };
    const Inner = captureAuth(holder);
    render(
        <AuthProvider>
            <Inner />
        </AuthProvider>,
    );
    if (!holder.current) {
        throw new Error('test setup: AuthContext consumer never ran');
    }
    return holder.current;
}

describe('AuthContext.logout · Phase 7 R-1', () => {
    beforeEach(() => {
        // Make sure we start each test with no stale auth principal.
        // authService is a real singleton; setup.ts already clears the
        // localStorage mock before each test, so we just need to mirror
        // the in-memory cached user.
        try {
            authService.logout();
        } catch {
            /* nothing to clear */
        }
    });

    it('calls recordingSessionService.reset()', async () => {
        const resetSpy = vi.spyOn(recordingSessionService, 'reset');
        const auth = mountAuth();

        await act(async () => {
            await auth.logout();
        });

        expect(resetSpy).toHaveBeenCalledTimes(1);
    });

    it('wipes every stored API key (clearAll behavior)', async () => {
        // Seed multiple providers; logout must purge all of them.
        keyStore.set('anthropic', 'API_KEY', 'sk-ant-1');
        keyStore.set('openai', 'API_KEY', 'sk-2');
        const auth = mountAuth();

        await act(async () => {
            await auth.logout();
        });

        expect(keyStore.get('anthropic', 'API_KEY')).toBe(null);
        expect(keyStore.get('openai', 'API_KEY')).toBe(null);
    });

    it('still clears auth principal (regression guard for existing behavior)', async () => {
        const authLogoutSpy = vi.spyOn(authService, 'logout');
        const auth = mountAuth();

        await act(async () => {
            await auth.logout();
        });

        expect(authLogoutSpy).toHaveBeenCalledTimes(1);
    });

    it('completes even if recordingSessionService.reset() throws', async () => {
        vi.spyOn(recordingSessionService, 'reset').mockImplementation(() => {
            throw new Error('boom');
        });
        const auth = mountAuth();

        await act(async () => {
            await expect(auth.logout()).resolves.not.toThrow();
        });
    });

    it('completes even if localStorage.removeItem throws during clearAll', async () => {
        keyStore.set('anthropic', 'API_KEY', 'sk-ant-1');
        // Force the underlying removeItem to throw — clearAll should
        // still resolve, and logout should still complete.
        vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
            throw new Error('boom');
        });
        const auth = mountAuth();

        await act(async () => {
            await expect(auth.logout()).resolves.not.toThrow();
        });
    });
});
