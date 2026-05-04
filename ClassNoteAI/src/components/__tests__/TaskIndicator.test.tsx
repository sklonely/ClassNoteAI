/**
 * TaskIndicator · v0.7.0 → Phase 7 Sprint 2 S2.5 改造
 *
 * Dual-source registry (taskTrackerService + offlineQueueService) merged
 * into a single UnifiedTask list. Both services are mocked at the module
 * boundary because the real taskTrackerService singleton lives behind an
 * S2.9 in-progress persist layer that needs Tauri commands not present
 * under jsdom — and even if it didn't, mocking gives us deterministic
 * subscriber control which is what the H18-TASKINDICATOR-MERGE doc spec
 * is really about.
 *
 * Coverage matches MERGE doc:
 *   - badge active count = running + queued (MERGE §4)
 *   - merge across both sources (§2)
 *   - SUMMARIZE_LECTURE / INDEX_LECTURE filtered on queue side (§6.1)
 *   - cancel only tracker (§3)
 *   - retry only tracker → cancel old + start new (§3 / §7.2)
 *   - sort: running → queued → failed → done (§5)
 *   - subscribe / unsubscribe lifecycle
 *
 * Not tested: SVG paths, animations, color tokens (jsdom limit).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PendingAction } from '../../services/offlineQueueService';
import type { TaskTrackerEntry } from '../../services/__contracts__/taskTrackerService.contract';

// ─── Mock both services at module boundary ──────────────────────────────

vi.mock('../../services/offlineQueueService', () => ({
  offlineQueueService: {
    init: vi.fn(() => Promise.resolve()),
    listActions: vi.fn(() => Promise.resolve([])),
    subscribe: vi.fn((_cb: (count: number) => void) => () => {}),
  },
}));

// We need a fakeTracker we can drive from tests. We expose a
// `__setTrackerSnapshot` helper that synchronously notifies all
// subscribers — that's the only "tracker behaviour" the indicator
// component actually consumes.
type TrackerSubscriber = (tasks: TaskTrackerEntry[]) => void;
const trackerSubs = new Set<TrackerSubscriber>();
let trackerSnapshot: TaskTrackerEntry[] = [];

function setTrackerSnapshot(next: TaskTrackerEntry[]) {
  trackerSnapshot = next;
  trackerSubs.forEach((cb) => cb([...next]));
}

const trackerCancel = vi.fn();
const trackerStart = vi.fn();

vi.mock('../../services/taskTrackerService', () => ({
  taskTrackerService: {
    subscribe: (cb: TrackerSubscriber) => {
      trackerSubs.add(cb);
      cb([...trackerSnapshot]); // immediate-fire pattern
      return () => {
        trackerSubs.delete(cb);
      };
    },
    cancel: (id: string) => {
      trackerCancel(id);
    },
    start: (input: unknown) => {
      trackerStart(input);
      return 'tracker-new-id';
    },
    reset: () => {
      trackerSnapshot = [];
      trackerSubs.clear();
    },
  },
}));

import TaskIndicator from '../TaskIndicator';
import { offlineQueueService } from '../../services/offlineQueueService';

const mocked = vi.mocked(offlineQueueService);

function pending(
  actionType: string,
  id = `id-${Math.random()}`,
  overrides: Partial<PendingAction> = {},
): PendingAction {
  return {
    id,
    actionType: actionType as PendingAction['actionType'],
    payload: '{}',
    status: 'pending',
    retryCount: 0,
    ...overrides,
  };
}

function trackerEntry(
  overrides: Partial<TaskTrackerEntry> = {},
): TaskTrackerEntry {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'summarize',
    label: '測試任務',
    progress: 0,
    status: 'queued',
    startedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  trackerSnapshot = [];
  trackerSubs.clear();
  trackerCancel.mockClear();
  trackerStart.mockClear();
  mocked.listActions.mockResolvedValue([]);
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => true,
  });
});

afterEach(() => {
  cleanup();
});

// ─── 1. trigger button — idle / active count ────────────────────────────

describe('TaskIndicator · trigger', () => {
  it('renders trigger with no count when nothing active', async () => {
    render(<TaskIndicator />);
    await waitFor(() => {
      expect(screen.getByTestId('task-indicator')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('task-count-badge')).not.toBeInTheDocument();
  });

  it('shows badge with count 1 when tracker has 1 running task', async () => {
    render(<TaskIndicator />);
    await waitFor(() => {
      expect(screen.getByTestId('task-indicator')).toBeInTheDocument();
    });

    act(() => {
      setTrackerSnapshot([
        trackerEntry({
          id: 't1',
          status: 'running',
          progress: 0.3,
          label: 'ML L4 摘要',
        }),
      ]);
    });

    const badge = await screen.findByTestId('task-count-badge');
    expect(badge).toHaveTextContent('1');
  });

  it('aggregates badge across tracker + queue (1 + 2 = 3)', async () => {
    mocked.listActions.mockResolvedValue([
      pending('AUTH_REGISTER', 'q1'),
      pending('PURGE_ITEM', 'q2'),
    ]);
    render(<TaskIndicator />);

    await waitFor(() => {
      const badge = screen.queryByTestId('task-count-badge');
      expect(badge).toHaveTextContent('2');
    });

    act(() => {
      setTrackerSnapshot([
        trackerEntry({ id: 't1', status: 'running', label: 'L1 摘要' }),
      ]);
    });

    const badge = await screen.findByTestId('task-count-badge');
    await waitFor(() => expect(badge).toHaveTextContent('3'));
  });
});

// ─── 2. SUMMARIZE_LECTURE / INDEX_LECTURE filter (MERGE §6.1) ───────────

describe('TaskIndicator · queue dedupe', () => {
  it('filters SUMMARIZE_LECTURE from queue side to avoid dual-display', async () => {
    mocked.listActions.mockResolvedValue([
      pending('AUTH_REGISTER', 'q1'),
      // These two are queue's restart-replay bookkeeping; the tracker
      // owns their UI, so the indicator must skip them.
      pending('SUMMARIZE_LECTURE' as never, 'q2'),
      pending('INDEX_LECTURE' as never, 'q3'),
    ]);
    render(<TaskIndicator />);

    const badge = await screen.findByTestId('task-count-badge');
    await waitFor(() => expect(badge).toHaveTextContent('1'));

    const user = userEvent.setup();
    await user.click(badge.closest('button')!);
    expect(screen.getByText('用戶註冊')).toBeInTheDocument();
    expect(screen.queryByText(/重啟續跑/)).not.toBeInTheDocument();
  });
});

// ─── 3. dropdown open/close + content ──────────────────────────────────

describe('TaskIndicator · dropdown', () => {
  it('opens panel when trigger clicked', async () => {
    const user = userEvent.setup();
    render(<TaskIndicator />);
    const trigger = await screen.findByTestId('task-indicator');

    expect(screen.queryByTestId('task-dropdown')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByTestId('task-dropdown')).toBeInTheDocument();
  });

  it('renders task label + progress bar for running tracker task', async () => {
    render(<TaskIndicator />);
    await waitFor(() => {
      expect(screen.getByTestId('task-indicator')).toBeInTheDocument();
    });

    act(() => {
      setTrackerSnapshot([
        trackerEntry({
          id: 't1',
          status: 'running',
          progress: 0.42,
          label: '生成摘要',
          lectureId: 'l1',
        }),
      ]);
    });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('task-indicator'));
    expect(screen.getByText('生成摘要')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('value', '0.42');
  });
});

// ─── 4. cancel button (tracker only) ─────────────────────────────────────

describe('TaskIndicator · cancel', () => {
  it('shows cancel button on running tracker task and calls service.cancel', async () => {
    render(<TaskIndicator />);
    await waitFor(() => {
      expect(screen.getByTestId('task-indicator')).toBeInTheDocument();
    });

    act(() => {
      setTrackerSnapshot([
        trackerEntry({ id: 't1', status: 'running', label: 'X 摘要' }),
      ]);
    });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('task-indicator'));

    const cancelBtn = screen.getByTestId('task-cancel-t1');
    expect(cancelBtn).toBeInTheDocument();

    await user.click(cancelBtn);
    expect(trackerCancel).toHaveBeenCalledWith('t1');
  });

  it('does NOT show cancel button for queue items (cancelable=false)', async () => {
    mocked.listActions.mockResolvedValue([pending('AUTH_REGISTER', 'q1')]);
    render(<TaskIndicator />);
    const badge = await screen.findByTestId('task-count-badge');
    const user = userEvent.setup();
    await user.click(badge.closest('button')!);

    expect(screen.getByText('用戶註冊')).toBeInTheDocument();
    expect(screen.queryByTestId('task-cancel-q1')).not.toBeInTheDocument();
  });
});

// ─── 5. failed + retry (tracker only) ───────────────────────────────────

describe('TaskIndicator · failed / retry', () => {
  it('shows error message + retry button for failed tracker task', async () => {
    render(<TaskIndicator />);
    await waitFor(() => {
      expect(screen.getByTestId('task-indicator')).toBeInTheDocument();
    });

    act(() => {
      setTrackerSnapshot([
        trackerEntry({
          id: 't1',
          status: 'failed',
          error: 'LLM 拒絕',
          label: '失敗任務',
        }),
      ]);
    });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('task-indicator'));

    expect(screen.getByText('失敗任務')).toBeInTheDocument();
    expect(screen.getByText(/LLM 拒絕/)).toBeInTheDocument();
    expect(screen.getByTestId('task-retry-t1')).toBeInTheDocument();
  });

  it('clicking retry cancels old + starts a new task with same kind/label/lectureId', async () => {
    render(<TaskIndicator />);
    await waitFor(() => {
      expect(screen.getByTestId('task-indicator')).toBeInTheDocument();
    });

    act(() => {
      setTrackerSnapshot([
        trackerEntry({
          id: 't1',
          status: 'failed',
          error: 'boom',
          label: 'L1 摘要',
          lectureId: 'l1',
          kind: 'summarize',
        }),
      ]);
    });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('task-indicator'));

    await user.click(screen.getByTestId('task-retry-t1'));

    expect(trackerCancel).toHaveBeenCalledWith('t1');
    expect(trackerStart).toHaveBeenCalledWith({
      kind: 'summarize',
      label: 'L1 摘要',
      lectureId: 'l1',
    });
  });
});

// ─── 6. empty state ─────────────────────────────────────────────────────

describe('TaskIndicator · empty state', () => {
  it('shows empty message when dropdown opened with no tasks', async () => {
    const user = userEvent.setup();
    render(<TaskIndicator />);
    const trigger = await screen.findByTestId('task-indicator');
    await user.click(trigger);
    expect(screen.getByText(/全部任務已完成|沒有進行中/)).toBeInTheDocument();
  });
});

// ─── 7. sort order — running → queued → failed → done ───────────────────

describe('TaskIndicator · sort', () => {
  it('renders running before queued before failed', async () => {
    render(<TaskIndicator />);
    await waitFor(() => {
      expect(screen.getByTestId('task-indicator')).toBeInTheDocument();
    });

    act(() => {
      setTrackerSnapshot([
        trackerEntry({
          id: 't-fail',
          status: 'failed',
          error: 'oops',
          label: 'A-FAIL',
          startedAt: 1000,
        }),
        trackerEntry({
          id: 't-queued',
          status: 'queued',
          label: 'B-QUEUED',
          startedAt: 2000,
        }),
        trackerEntry({
          id: 't-running',
          status: 'running',
          label: 'C-RUNNING',
          startedAt: 3000,
        }),
      ]);
    });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('task-indicator'));

    const labels = screen
      .getAllByTestId(/^task-row-/)
      .map((el) => el.textContent ?? '');
    expect(labels[0]).toContain('C-RUNNING');
    expect(labels[1]).toContain('B-QUEUED');
    expect(labels[2]).toContain('A-FAIL');
  });
});

// ─── 8. subscription lifecycle ──────────────────────────────────────────

describe('TaskIndicator · subscription lifecycle', () => {
  it('subscribes to offlineQueue on mount and unsubscribes on unmount', async () => {
    const queueUnsub = vi.fn();
    mocked.subscribe.mockReturnValueOnce(queueUnsub);
    const { unmount } = render(<TaskIndicator />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocked.subscribe).toHaveBeenCalled();
    unmount();
    expect(queueUnsub).toHaveBeenCalled();
  });

  it('subscribes to taskTrackerService on mount and unsubscribes on unmount', async () => {
    const { unmount } = render(<TaskIndicator />);
    await act(async () => {
      await Promise.resolve();
    });
    // immediate-fire wired one cb in
    expect(trackerSubs.size).toBe(1);
    unmount();
    expect(trackerSubs.size).toBe(0);
  });
});
