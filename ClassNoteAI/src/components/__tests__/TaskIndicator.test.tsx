/**
 * TaskIndicator · v0.7.0 H18 重做
 *
 * 行為測試：
 *   - 整合 offlineQueueService API (init / listActions / subscribe)
 *   - idle / active / offline 三種視覺狀態切換
 *   - dropdown 開合 (click button / click outside)
 *   - dropdown 列表顯示 pending action labels
 *   - ONLINE / OFFLINE pill
 *   - retry count 顯示
 *
 * 不測：實際 SVG 路徑 / dropdown 動畫 / 色彩 (jsdom 限制)
 *
 * 保留：sync-label regression — 確保 SYNC_PUSH 等廢棄 type 不會
 * 意外被 friendly-label 化。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PendingAction } from '../../services/offlineQueueService';

vi.mock('../../services/offlineQueueService', () => ({
  offlineQueueService: {
    init: vi.fn(() => Promise.resolve()),
    listActions: vi.fn(() => Promise.resolve([])),
    subscribe: vi.fn((_cb: (count: number) => void) => () => {}),
  },
}));

import TaskIndicator from '../TaskIndicator';
import { offlineQueueService } from '../../services/offlineQueueService';

const mocked = vi.mocked(offlineQueueService);

function pending(actionType: string, id = `id-${Math.random()}`, overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id,
    actionType: actionType as PendingAction['actionType'],
    payload: '{}',
    status: 'pending',
    retryCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  mocked.listActions.mockResolvedValue([]);
  // restore navigator.onLine to true between tests
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => true,
  });
});

afterEach(() => {
  cleanup();
});

describe('TaskIndicator · idle state', () => {
  it('renders cloud icon with idle title', async () => {
    render(<TaskIndicator />);
    await waitFor(() => {
      expect(screen.getByTitle('無進行中任務')).toBeInTheDocument();
    });
  });

  it('does not show count badge when idle', async () => {
    render(<TaskIndicator />);
    await waitFor(() => {
      expect(screen.getByTitle('無進行中任務')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('task-count-badge')).not.toBeInTheDocument();
  });
});

describe('TaskIndicator · active state', () => {
  it('shows count badge with pending count', async () => {
    mocked.listActions.mockResolvedValue([
      pending('AUTH_REGISTER', 'a'),
      pending('PURGE_ITEM', 'b'),
    ]);
    render(<TaskIndicator />);
    const badge = await screen.findByTestId('task-count-badge');
    expect(badge).toHaveTextContent('2');
  });

  it('uses active title with count', async () => {
    mocked.listActions.mockResolvedValue([pending('AUTH_REGISTER')]);
    render(<TaskIndicator />);
    await waitFor(() => {
      expect(screen.getByTitle('1 個任務進行中')).toBeInTheDocument();
    });
  });

  it('does not include completed actions in count', async () => {
    mocked.listActions.mockResolvedValue([
      pending('AUTH_REGISTER', 'a'),
      pending('PURGE_ITEM', 'b', { status: 'completed' }),
    ]);
    render(<TaskIndicator />);
    const badge = await screen.findByTestId('task-count-badge');
    expect(badge).toHaveTextContent('1');
  });
});

describe('TaskIndicator · offline state', () => {
  it('uses offline title when navigator is offline and no tasks', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    render(<TaskIndicator />);
    await waitFor(() => {
      expect(screen.getByTitle('網路斷線')).toBeInTheDocument();
    });
  });
});

describe('TaskIndicator · dropdown', () => {
  it('toggles open / closed when button clicked', async () => {
    const user = userEvent.setup();
    mocked.listActions.mockResolvedValue([pending('AUTH_REGISTER')]);
    render(<TaskIndicator />);
    const btn = await screen.findByTitle('1 個任務進行中');

    expect(screen.queryByTestId('task-dropdown')).not.toBeInTheDocument();
    await user.click(btn);
    expect(screen.getByTestId('task-dropdown')).toBeInTheDocument();
    await user.click(btn);
    expect(screen.queryByTestId('task-dropdown')).not.toBeInTheDocument();
  });

  it('shows action labels for known types', async () => {
    const user = userEvent.setup();
    mocked.listActions.mockResolvedValue([
      pending('AUTH_REGISTER', 'a'),
      pending('PURGE_ITEM', 'b'),
    ]);
    render(<TaskIndicator />);
    const btn = await screen.findByTitle('2 個任務進行中');
    await user.click(btn);
    expect(screen.getByText('用戶註冊')).toBeInTheDocument();
    expect(screen.getByText('永久刪除')).toBeInTheDocument();
  });

  it('shows TASKS · N header with count', async () => {
    const user = userEvent.setup();
    mocked.listActions.mockResolvedValue([pending('AUTH_REGISTER')]);
    render(<TaskIndicator />);
    const btn = await screen.findByTitle('1 個任務進行中');
    await user.click(btn);
    expect(screen.getByText(/TASKS · 1/)).toBeInTheDocument();
  });

  it('shows ONLINE pill when online', async () => {
    const user = userEvent.setup();
    mocked.listActions.mockResolvedValue([pending('AUTH_REGISTER')]);
    render(<TaskIndicator />);
    const btn = await screen.findByTitle('1 個任務進行中');
    await user.click(btn);
    expect(screen.getByText('ONLINE')).toBeInTheDocument();
  });

  it('shows OFFLINE pill when offline', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    const user = userEvent.setup();
    mocked.listActions.mockResolvedValue([pending('AUTH_REGISTER')]);
    render(<TaskIndicator />);
    // Offline takes precedence in title, so find via the count badge.
    const badge = await screen.findByTestId('task-count-badge');
    const btn = badge.closest('button')!;
    await user.click(btn);
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
  });

  it('shows empty-state message when no tasks but dropdown opened', async () => {
    const user = userEvent.setup();
    render(<TaskIndicator />);
    const btn = await screen.findByTitle('無進行中任務');
    await user.click(btn);
    expect(screen.getByText(/全部任務已完成/)).toBeInTheDocument();
  });

  it('shows offline empty-state hint when offline and no tasks', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    const user = userEvent.setup();
    render(<TaskIndicator />);
    const btn = await screen.findByTitle('網路斷線');
    await user.click(btn);
    expect(screen.getByText(/網路斷線.*排隊/)).toBeInTheDocument();
  });

  it('shows retry count when retryCount > 0', async () => {
    const user = userEvent.setup();
    mocked.listActions.mockResolvedValue([
      pending('AUTH_REGISTER', 'a', { retryCount: 2, status: 'failed' }),
    ]);
    render(<TaskIndicator />);
    const btn = await screen.findByTitle('1 個任務進行中');
    await user.click(btn);
    expect(screen.getByText(/重試.*2.*3/)).toBeInTheDocument();
  });

  it('shows failed status badge for failed actions', async () => {
    const user = userEvent.setup();
    mocked.listActions.mockResolvedValue([
      pending('AUTH_REGISTER', 'a', { status: 'failed' }),
    ]);
    render(<TaskIndicator />);
    const btn = await screen.findByTitle('1 個任務進行中');
    await user.click(btn);
    expect(screen.getByText('失敗')).toBeInTheDocument();
  });
});

describe('TaskIndicator · click-outside', () => {
  it('closes dropdown when clicking outside', async () => {
    const user = userEvent.setup();
    mocked.listActions.mockResolvedValue([pending('AUTH_REGISTER')]);
    render(
      <div>
        <TaskIndicator />
        <button data-testid="outside">outside</button>
      </div>,
    );
    const btn = await screen.findByTitle('1 個任務進行中');
    await user.click(btn);
    expect(screen.getByTestId('task-dropdown')).toBeInTheDocument();

    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByTestId('task-dropdown')).not.toBeInTheDocument();
  });
});

describe('TaskIndicator · sync-label regression', () => {
  it('never renders sync-related Chinese labels', async () => {
    const user = userEvent.setup();
    mocked.listActions.mockResolvedValue([pending('AUTH_REGISTER')]);
    render(<TaskIndicator />);
    const btn = await screen.findByTitle('1 個任務進行中');
    await user.click(btn);
    for (const banned of ['同步上傳', '同步下載', '裝置註冊', '移除裝置']) {
      expect(screen.queryByText(banned)).not.toBeInTheDocument();
    }
  });
});

describe('TaskIndicator · subscription lifecycle', () => {
  it('subscribes on mount and unsubscribes on unmount', async () => {
    const unsubscribe = vi.fn();
    mocked.subscribe.mockReturnValueOnce(unsubscribe);
    const { unmount } = render(<TaskIndicator />);
    await act(async () => { await Promise.resolve(); });
    expect(mocked.subscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
