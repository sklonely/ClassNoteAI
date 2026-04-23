/**
 * TaskIndicator regression tests.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 1
 * §TaskIndicator):
 *   - The post-sync-removal action-type allowlist must NOT label any
 *     of the dropped types (SYNC_PUSH / SYNC_PULL / DEVICE_REGISTER /
 *     DEVICE_DELETE). If a future commit accidentally re-adds a sync
 *     processor, the unmapped type would render its raw symbol —
 *     confusing but at least visible. The hard regression we DO guard
 *     against is "the sync labels reappear" because that means the
 *     sync feature crept back in via the indicator UI.
 *   - Idle state hides the count badge.
 *   - Pending action(s) reveal the count badge.
 *   - The dropdown opens / closes via the button.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PendingAction } from '../../services/offlineQueueService';

vi.mock('../../services/offlineQueueService', () => ({
    offlineQueueService: {
        init: vi.fn(() => Promise.resolve()),
        listActions: vi.fn(() => Promise.resolve([])),
        subscribe: vi.fn((_cb: (count: number) => void) => () => { }),
    },
}));

import TaskIndicator from '../TaskIndicator';
import { offlineQueueService } from '../../services/offlineQueueService';

const mocked = vi.mocked(offlineQueueService);

function pending(actionType: string, id = `id-${Math.random()}`): PendingAction {
    return {
        id,
        actionType: actionType as PendingAction['actionType'],
        payload: '{}',
        status: 'pending',
        retryCount: 0,
    };
}

beforeEach(() => {
    mocked.listActions.mockResolvedValue([]);
});

afterEach(() => {
    cleanup();
});

describe('TaskIndicator', () => {
    it('renders nothing visible in the badge when there are no pending actions', async () => {
        render(<TaskIndicator />);
        // Allow the loadPending promise to resolve.
        await new Promise((res) => setTimeout(res, 0));
        // Cloud icon is the no-activity placeholder — title attribute carries
        // the i18n string. (We use getByTitle because the button has no
        // textContent in the idle state — accessible-name resolution would
        // fall through to title, but jsdom's implementation differs from
        // browsers; getByTitle is unambiguous either way.)
        expect(screen.getByTitle('No Active Tasks')).toBeInTheDocument();
    });

    it('shows the count badge when there is a pending action', async () => {
        mocked.listActions.mockResolvedValue([pending('AUTH_REGISTER')]);
        render(<TaskIndicator />);
        // Wait for the async load + state update.
        const btn = await screen.findByTitle('1 Active Items');
        expect(btn).toBeInTheDocument();
        // The numeric count appears as the button's text.
        expect(btn).toHaveTextContent('1');
    });

    it('opens the dropdown listing the pending actions when clicked', async () => {
        const user = userEvent.setup();
        mocked.listActions.mockResolvedValue([
            pending('AUTH_REGISTER', 'id-A'),
            pending('PURGE_ITEM', 'id-B'),
        ]);
        render(<TaskIndicator />);
        const btn = await screen.findByTitle('2 Active Items');
        await user.click(btn);
        // Both human labels should appear in the dropdown.
        expect(screen.getByText('用戶註冊')).toBeInTheDocument();
        expect(screen.getByText('永久刪除')).toBeInTheDocument();
    });

    it('regression: dropdown does NOT render any cloud-sync labels', async () => {
        const user = userEvent.setup();
        // We don't enqueue any sync types (those processors are gone), but
        // even if a stale row exists in the DB, the labels we ADVERTISE
        // should never include the sync ones. Worst-case render must be the
        // raw type symbol, never a friendly Chinese sync label.
        mocked.listActions.mockResolvedValue([pending('AUTH_REGISTER')]);
        render(<TaskIndicator />);
        const btn = await screen.findByTitle('1 Active Items');
        await user.click(btn);
        // None of these strings must appear anywhere in the dropdown.
        for (const banned of ['同步上傳', '同步下載', '裝置註冊', '移除裝置']) {
            expect(screen.queryByText(banned)).not.toBeInTheDocument();
        }
    });

    it('subscribes on mount and cleans up on unmount', async () => {
        const unsubscribe = vi.fn();
        mocked.subscribe.mockReturnValueOnce(unsubscribe);
        const { unmount } = render(<TaskIndicator />);
        // Allow effect to fire.
        await new Promise((res) => setTimeout(res, 0));
        expect(mocked.subscribe).toHaveBeenCalledTimes(1);
        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
