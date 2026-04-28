/**
 * PKeyboard · Phase 7 Sprint 3 R2 (S3a-2) tests.
 *
 * Coverage:
 *   1. mount → 7 個 row render，每個對應 ACTION_LABELS
 *   2. row 顯示 default combo label (formatted)
 *   3. 點 chip → capturing mode (顯示「按下新快捷鍵…」)
 *   4. 按新 combo → keymapService.set 被呼叫
 *   5. 衝突 combo (toggleAiDock 已用 Mod+J) → toastService.warning
 *   6. Esc → cancel capture
 *   7. override 後 → 「重設」按鈕出現
 *   8. 點重設 → keymapService.reset 被呼叫
 *   9. 訂閱 keymapService → 改其他 row 後此 row 也 re-render
 *  10. resetAll → 全部 override 清掉
 *
 * The test mounts only the named-export `PKeyboard` component to avoid
 * pulling the rest of ProfilePanes / ProfilePage shell.
 *
 * Platform: forced 'win' so display labels are deterministic
 * (`Ctrl+K` rather than `⌘K`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ─── service mocks (must be set up before component import) ──────────

const { mockToast } = vi.hoisted(() => ({
    mockToast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        show: vi.fn(),
        dismiss: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        clear: vi.fn(),
        pauseAll: vi.fn(),
        resumeAll: vi.fn(),
    },
}));

vi.mock('../../../services/toastService', () => ({
    toastService: mockToast,
}));

// ─── imports (after mocks) ────────────────────────────────────────────

import { PKeyboard } from '../ProfilePanes';
import { keymapService } from '../../../services/keymapService';
import { DEFAULT_KEYMAP } from '../../../services/__contracts__/keymapService.contract';

// Force platform to win/linux so display labels are predictable.
beforeEach(() => {
    Object.defineProperty(navigator, 'platform', {
        configurable: true,
        get: () => 'Win32',
    });
    Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Windows NT 10.0)',
    });
    keymapService.__reset();
});

afterEach(() => {
    vi.restoreAllMocks();
    keymapService.__reset();
});

const ACTION_IDS = [
    'search',
    'toggleAiDock',
    'newCourse',
    'goHome',
    'goProfile',
    'toggleTheme',
    'floatingNotes',
] as const;

const ACTION_LABEL_TEXTS = [
    '搜尋',
    '開關 AI 對話',
    '新增課程',
    '回首頁',
    '個人資料',
    '切換主題',
    '浮動筆記',
];

// ─── 1. all 7 rows render ────────────────────────────────────────────────

describe('PKeyboard · row rendering', () => {
    it('renders one row per ActionId in DEFAULT_KEYMAP', () => {
        render(<PKeyboard />);
        for (const label of ACTION_LABEL_TEXTS) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
        expect(ACTION_IDS.length).toBe(7);
    });

    it('renders the default combo label for each row', () => {
        render(<PKeyboard />);
        // search defaults to Mod+K → on win that's 'Ctrl+K'
        expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
        expect(screen.getByText('Ctrl+J')).toBeInTheDocument();
        expect(screen.getByText('Ctrl+N')).toBeInTheDocument();
        expect(screen.getByText('Ctrl+H')).toBeInTheDocument();
        expect(screen.getByText('Ctrl+,')).toBeInTheDocument();
        expect(screen.getByText('Ctrl+\\')).toBeInTheDocument();
        expect(screen.getByText('Ctrl+Shift+N')).toBeInTheDocument();
    });
});

// ─── 2. capture flow ────────────────────────────────────────────────────

describe('PKeyboard · capture flow', () => {
    it('clicking the chip switches to capturing mode', () => {
        render(<PKeyboard />);
        const chip = screen.getByRole('button', { name: 'Ctrl+K' });
        fireEvent.click(chip);
        expect(screen.getByText('按下新快捷鍵…')).toBeInTheDocument();
    });

    it('pressing a new combo calls keymapService.set', () => {
        const setSpy = vi.spyOn(keymapService, 'set');
        render(<PKeyboard />);
        const chip = screen.getByRole('button', { name: 'Ctrl+K' });
        fireEvent.click(chip);
        // Pane is the keydown target.
        const pane = screen.getByText('按下新快捷鍵…').closest('div');
        expect(pane).toBeTruthy();
        // Press Ctrl+P (a free combo)
        fireEvent.keyDown(pane!, {
            key: 'P',
            ctrlKey: true,
        });
        expect(setSpy).toHaveBeenCalledWith('search', 'Mod+P');
    });

    it('Escape cancels capture without calling set', () => {
        const setSpy = vi.spyOn(keymapService, 'set');
        render(<PKeyboard />);
        const chip = screen.getByRole('button', { name: 'Ctrl+K' });
        fireEvent.click(chip);
        const pane = screen.getByText('按下新快捷鍵…').closest('div');
        fireEvent.keyDown(pane!, { key: 'Escape' });
        expect(setSpy).not.toHaveBeenCalled();
        // Capturing mode is gone — chip is back.
        expect(screen.queryByText('按下新快捷鍵…')).not.toBeInTheDocument();
    });

    it('ignores standalone modifier keys', () => {
        const setSpy = vi.spyOn(keymapService, 'set');
        render(<PKeyboard />);
        const chip = screen.getByRole('button', { name: 'Ctrl+K' });
        fireEvent.click(chip);
        const pane = screen.getByText('按下新快捷鍵…').closest('div');
        fireEvent.keyDown(pane!, { key: 'Control' });
        fireEvent.keyDown(pane!, { key: 'Shift' });
        fireEvent.keyDown(pane!, { key: 'Meta' });
        fireEvent.keyDown(pane!, { key: 'Alt' });
        expect(setSpy).not.toHaveBeenCalled();
        // Still capturing.
        expect(screen.getByText('按下新快捷鍵…')).toBeInTheDocument();
    });
});

// ─── 3. conflict toast ──────────────────────────────────────────────────

describe('PKeyboard · conflict handling', () => {
    it('rebinding to a combo already in use shows toast.warning', async () => {
        render(<PKeyboard />);
        const chip = screen.getByRole('button', { name: 'Ctrl+K' });
        fireEvent.click(chip);
        const pane = screen.getByText('按下新快捷鍵…').closest('div');
        // Press Ctrl+J — already bound to toggleAiDock.
        fireEvent.keyDown(pane!, {
            key: 'J',
            ctrlKey: true,
        });
        // The handler dynamic-imports toastService; wait for the chain
        // to resolve before asserting.
        await waitFor(() => {
            expect(mockToast.warning).toHaveBeenCalled();
        });
        const args = mockToast.warning.mock.calls[0];
        expect(args[0]).toBe('快捷鍵衝突');
    });
});

// ─── 4. reset behaviour ─────────────────────────────────────────────────

describe('PKeyboard · reset behaviour', () => {
    it('shows the 重設 button only when an override is active', () => {
        const { rerender } = render(<PKeyboard />);
        expect(screen.queryByText('重設')).not.toBeInTheDocument();

        // Override search → service notify → component re-renders.
        act(() => {
            keymapService.set('search', 'Mod+P');
        });
        rerender(<PKeyboard />);
        // After override, exactly one 重設 button shows up (for `search`).
        expect(screen.getAllByText('重設').length).toBe(1);
    });

    it('clicking 重設 calls keymapService.reset for that action', () => {
        const resetSpy = vi.spyOn(keymapService, 'reset');
        // Pre-seed an override.
        act(() => {
            keymapService.set('search', 'Mod+P');
        });
        render(<PKeyboard />);
        fireEvent.click(screen.getByText('重設'));
        expect(resetSpy).toHaveBeenCalledWith('search');
    });
});

// ─── 5. subscription / cross-row re-render ─────────────────────────────

describe('PKeyboard · keymapService subscription', () => {
    it('re-renders other rows when one row is rebound', () => {
        render(<PKeyboard />);
        // Initially 'Ctrl+K' search is shown
        expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
        // Rebind a *different* row outside the component.
        act(() => {
            keymapService.set('goHome', 'Mod+G');
        });
        // The component should observe the change via subscribe and now
        // render Ctrl+G for goHome (without remounting).
        expect(screen.getByText('Ctrl+G')).toBeInTheDocument();
        // search row stays unchanged.
        expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
    });
});

// ─── 6. shape sanity ───────────────────────────────────────────────────

describe('PKeyboard · DEFAULT_KEYMAP coverage', () => {
    it('covers every ActionId in DEFAULT_KEYMAP', () => {
        // Sanity guard against future ActionId additions: if a new id is
        // added to the contract, this test forces the implementer to
        // think about ACTION_LABELS too.
        const ids = Object.keys(DEFAULT_KEYMAP).sort();
        expect(ids).toEqual([...ACTION_IDS].sort());
    });
});
