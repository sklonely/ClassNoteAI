/**
 * ProfileView regression tests (post-sync removal, alpha.10).
 *
 * Coverage targets (from regression-test-checklist.md, Phase 1
 * §ProfileView):
 *   - The profile view used to host the entire cloud-sync UI (status
 *     panel, manual sync button, connected-devices list). After sync
 *     was removed in alpha.10, ProfileView became a tiny user-card +
 *     logout shell. THE CRITICAL REGRESSION GUARD here is "no sync
 *     copy ever reappears" — if a future contributor restores a sync
 *     section, this test fails loudly.
 *   - User card renders username + last_login.
 *   - "未登錄" placeholder when no user.
 *   - Logout button calls logout.
 *   - Optional onClose callback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '../../services/authService';

const useAuthMock = vi.fn();
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => useAuthMock(),
}));

import ProfileView from '../ProfileView';

function makeUser(overrides: Partial<User> = {}): User {
    return {
        username: 'alice',
        isVerified: true,
        last_login: '2026-04-22T12:34:56Z',
        ...overrides,
    };
}

beforeEach(() => {
    useAuthMock.mockReset();
});

afterEach(() => {
    cleanup();
});

describe('ProfileView (post-sync removal)', () => {
    it('renders username + last_login from useAuth', () => {
        useAuthMock.mockReturnValue({ user: makeUser({ username: 'alice' }), logout: vi.fn() });
        render(<ProfileView />);
        expect(screen.getByText('alice')).toBeInTheDocument();
        expect(screen.getByText(/上次登錄:/)).toBeInTheDocument();
    });

    it('renders the "未登錄" placeholder when no user', () => {
        useAuthMock.mockReturnValue({ user: null, logout: vi.fn() });
        render(<ProfileView />);
        expect(screen.getByText('未登錄')).toBeInTheDocument();
        expect(screen.getByText(/上次登錄: -/)).toBeInTheDocument();
    });

    it('clicking 登出 calls the logout function from useAuth', async () => {
        const user = userEvent.setup();
        const logout = vi.fn();
        useAuthMock.mockReturnValue({ user: makeUser(), logout });
        render(<ProfileView />);
        await user.click(screen.getByRole('button', { name: /登出/ }));
        expect(logout).toHaveBeenCalledTimes(1);
    });

    it('does not render the close button when onClose is not provided', () => {
        useAuthMock.mockReturnValue({ user: makeUser(), logout: vi.fn() });
        render(<ProfileView />);
        expect(screen.queryByRole('button', { name: '關閉' })).not.toBeInTheDocument();
    });

    it('renders the close button and forwards click to onClose when provided', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        useAuthMock.mockReturnValue({ user: makeUser(), logout: vi.fn() });
        render(<ProfileView onClose={onClose} />);
        await user.click(screen.getByRole('button', { name: '關閉' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('regression: must NOT render any cloud-sync UI', () => {
        useAuthMock.mockReturnValue({ user: makeUser(), logout: vi.fn() });
        render(<ProfileView />);
        // Every string the pre-removal sync section used to ship.
        const banned = [
            '雲端同步',
            '同步狀態',
            '立即同步',
            '自動同步',
            '已連接設備',
            '同步成功',
            '同步失敗',
            '從未同步',
            '上次同步',
        ];
        for (const phrase of banned) {
            expect(
                screen.queryByText(phrase),
                `cloud-sync UI string "${phrase}" reappeared in ProfileView`,
            ).not.toBeInTheDocument();
        }
    });
});
