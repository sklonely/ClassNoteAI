/**
 * RecoveryHintBanner tests · Phase 7 Sprint 1 (S1.9)
 *
 * 規格：當 recoveryService 修復成功後 set localStorage flag
 * `_recovery:<lectureId>`，本 banner 偵測到該 flag 就顯示，提供
 * dismiss button — 按下會把該 flag 從 localStorage 移除並隱藏。
 *
 * 對應 PHASE-7-PLAN.md §2 Sprint 1 N6（Recovery hint）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveryHintBanner } from '../RecoveryHintBanner';

const FLAG_PREFIX = '_recovery:';

beforeEach(() => {
    // setup.ts already clears localStorage globally before each test, but be explicit.
    localStorage.clear();
});

describe('RecoveryHintBanner', () => {
    it('does not render when no recovery flag exists for lectureId', () => {
        render(<RecoveryHintBanner lectureId="lec-1" />);
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('button', { name: '關閉提示' })).toBeNull();
    });

    it('renders when recovery flag exists for lectureId', () => {
        localStorage.setItem(`${FLAG_PREFIX}lec-1`, '1');
        render(<RecoveryHintBanner lectureId="lec-1" />);
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(
            screen.getByText(/這堂課因為應用程式或系統崩潰時被自動還原/)
        ).toBeInTheDocument();
    });

    it('hides banner and removes localStorage flag when dismiss clicked', () => {
        localStorage.setItem(`${FLAG_PREFIX}lec-1`, '1');
        render(<RecoveryHintBanner lectureId="lec-1" />);

        const btn = screen.getByRole('button', { name: '關閉提示' });
        fireEvent.click(btn);

        expect(screen.queryByRole('status')).toBeNull();
        expect(localStorage.getItem(`${FLAG_PREFIX}lec-1`)).toBeNull();
    });

    it('calls onDismiss callback when dismiss clicked', () => {
        localStorage.setItem(`${FLAG_PREFIX}lec-1`, '1');
        const onDismiss = vi.fn();
        render(<RecoveryHintBanner lectureId="lec-1" onDismiss={onDismiss} />);

        fireEvent.click(screen.getByRole('button', { name: '關閉提示' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('re-checks localStorage when lectureId changes', () => {
        localStorage.setItem(`${FLAG_PREFIX}lec-2`, '1');
        const { rerender } = render(<RecoveryHintBanner lectureId="lec-1" />);
        // lec-1 has no flag → not rendered
        expect(screen.queryByRole('status')).toBeNull();

        // Switch to lec-2 (which has flag) → banner should appear
        rerender(<RecoveryHintBanner lectureId="lec-2" />);
        expect(screen.getByRole('status')).toBeInTheDocument();

        // Switch back to lec-1 → banner gone
        rerender(<RecoveryHintBanner lectureId="lec-1" />);
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('silently hides (does not crash) when localStorage.getItem throws', () => {
        const spy = vi
            .spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => {
                throw new Error('SecurityError: localStorage blocked');
            });

        // Should not throw
        expect(() =>
            render(<RecoveryHintBanner lectureId="lec-1" />)
        ).not.toThrow();
        expect(screen.queryByRole('status')).toBeNull();

        spy.mockRestore();
    });

    it('does not render dismiss button when banner is hidden', () => {
        // No flag set → hidden
        render(<RecoveryHintBanner lectureId="lec-1" />);
        expect(
            screen.queryByRole('button', { name: '關閉提示' })
        ).toBeNull();
    });

    it('dismiss button has aria-label="關閉提示"', () => {
        localStorage.setItem(`${FLAG_PREFIX}lec-1`, '1');
        render(<RecoveryHintBanner lectureId="lec-1" />);

        const btn = screen.getByRole('button', { name: '關閉提示' });
        expect(btn).toHaveAttribute('aria-label', '關閉提示');
    });

    it('banner has role="status" + aria-live="polite"', () => {
        localStorage.setItem(`${FLAG_PREFIX}lec-1`, '1');
        render(<RecoveryHintBanner lectureId="lec-1" />);

        const banner = screen.getByRole('status');
        expect(banner).toHaveAttribute('aria-live', 'polite');
    });

    it('does not crash when localStorage.removeItem throws on dismiss', () => {
        localStorage.setItem(`${FLAG_PREFIX}lec-1`, '1');
        render(<RecoveryHintBanner lectureId="lec-1" />);

        const removeSpy = vi
            .spyOn(Storage.prototype, 'removeItem')
            .mockImplementation(() => {
                throw new Error('quota / blocked');
            });

        const btn = screen.getByRole('button', { name: '關閉提示' });
        expect(() => fireEvent.click(btn)).not.toThrow();
        // Banner still hides locally even if storage write failed
        expect(screen.queryByRole('status')).toBeNull();

        removeSpy.mockRestore();
    });
});
