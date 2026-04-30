/**
 * usageTracker user-scope tests · cp75.26 P1-D.
 *
 * Pre-cp75.26 the tracker wrote to a single global localStorage key
 * (`llm.usageTracker.events.v1`). On a shared machine that meant User
 * A's token usage bled into User B's "today" summary on
 * SettingsAboutUpdates. cp75.3 introduced the `<userId>::<key>`
 * composite-key pattern — usageTracker missed the migration.
 *
 * Coverage:
 *   - new writes go to the user-scoped key, NOT the legacy unscoped
 *     key
 *   - switching users isolates `latest()` (a new user starts blank)
 *   - falls back to the `default_user` segment when no user is logged
 *     in (boot window before login)
 *
 * vi.resetModules between tests so the module-level `usageTracker`
 * singleton picks up the fresh authService mock for each scenario.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let userIdSegmentMock = vi.fn(() => 'sk');

vi.mock('../../authService', () => ({
    authService: {
        get getUserIdSegment() {
            return userIdSegmentMock;
        },
        getUser: vi.fn(() => ({ username: 'sk', isVerified: true })),
    },
}));

beforeEach(() => {
    localStorage.clear();
    userIdSegmentMock = vi.fn(() => 'sk');
    vi.resetModules();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('usageTracker · cp75.26 user-scoped storage', () => {
    it('writes to a user-scoped localStorage key (and NOT the legacy unscoped one)', async () => {
        const { usageTracker } = await import('../usageTracker');
        usageTracker.record({
            providerId: 'p',
            model: 'm',
            task: 'chat',
            inputTokens: 10,
            outputTokens: 5,
        });

        expect(localStorage.getItem('sk::llm.usageTracker.events.v1')).not.toBeNull();
        expect(localStorage.getItem('llm.usageTracker.events.v1')).toBeNull();
    });

    it('switching users isolates usage history (new user starts blank)', async () => {
        // User "sk" records an event under their bucket.
        let mod = await import('../usageTracker');
        mod.usageTracker.record({
            providerId: 'p',
            model: 'm',
            task: 'chat',
            inputTokens: 10,
            outputTokens: 5,
        });

        expect(mod.usageTracker.latest('chat')).not.toBeNull();
        const skBlob = localStorage.getItem('sk::llm.usageTracker.events.v1');
        expect(skBlob).not.toBeNull();

        // Simulate user switch: re-mock segment to 'other' and re-import
        // the module so the singleton's loadFromStorage() reads the new
        // bucket (which is empty for "other").
        userIdSegmentMock = vi.fn(() => 'other');
        vi.resetModules();
        mod = await import('../usageTracker');

        // No record for "other" yet → latest() returns null.
        expect(mod.usageTracker.latest('chat')).toBeNull();

        // And "sk"'s blob is still where we left it.
        expect(localStorage.getItem('sk::llm.usageTracker.events.v1')).toBe(skBlob);
    });

    it('falls back to the default_user segment when authService returns no user', async () => {
        userIdSegmentMock = vi.fn(() => 'default_user');
        const { usageTracker } = await import('../usageTracker');
        usageTracker.record({
            providerId: 'p',
            model: 'm',
            task: 'chat',
            inputTokens: 1,
            outputTokens: 1,
        });

        expect(
            localStorage.getItem('default_user::llm.usageTracker.events.v1'),
        ).not.toBeNull();
        expect(localStorage.getItem('llm.usageTracker.events.v1')).toBeNull();
    });
});
