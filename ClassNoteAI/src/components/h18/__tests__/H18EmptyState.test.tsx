/**
 * H18EmptyState tests · Phase 7 Sprint 3 Round 3 (W13)
 *
 * Specs covered:
 *   1. mount + heading only → render heading
 *   2. + description → both render
 *   3. + icon → icon rendered (and visible to test via testid)
 *   4. + cta → button render，點下去 onClick fires
 *   5. cta.variant='primary' → .primary class applied
 *   6. role="status" 確保 a11y screen reader friendly
 *   7. icon wrapper aria-hidden
 *   8. CTA optional — 沒提供時不 render button
 *   + secondary variant 不帶 .primary class
 *   + description 不提供時不 render
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { H18EmptyState } from '../H18EmptyState';

describe('H18EmptyState', () => {
    it('renders heading when only heading provided', () => {
        render(<H18EmptyState heading="收件夾是空的" />);
        expect(screen.getByText('收件夾是空的')).toBeInTheDocument();
    });

    it('renders heading + description when both provided', () => {
        render(
            <H18EmptyState
                heading="收件夾是空的"
                description="新公告 / 作業到期會出現在這裡。"
            />,
        );
        expect(screen.getByText('收件夾是空的')).toBeInTheDocument();
        expect(
            screen.getByText('新公告 / 作業到期會出現在這裡。'),
        ).toBeInTheDocument();
    });

    it('does NOT render description block when description omitted', () => {
        const { container } = render(<H18EmptyState heading="只有 heading" />);
        // No description text node beyond heading itself
        expect(screen.queryByText(/.+。/)).toBeNull();
        // Sanity: heading still there
        expect(container.textContent).toContain('只有 heading');
    });

    it('renders icon when icon provided', () => {
        render(
            <H18EmptyState
                icon={<svg data-testid="empty-icon" />}
                heading="找不到結果"
            />,
        );
        expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    });

    it('does NOT render icon wrapper when icon omitted', () => {
        const { container } = render(<H18EmptyState heading="無 icon" />);
        // No svg / no aria-hidden wrapper
        expect(container.querySelector('svg')).toBeNull();
        expect(container.querySelector('[aria-hidden]')).toBeNull();
    });

    it('renders cta button and fires onClick on click', () => {
        const onClick = vi.fn();
        render(
            <H18EmptyState
                heading="這堂課還沒有內容"
                cta={{ label: '匯入材料', onClick }}
            />,
        );
        const btn = screen.getByRole('button', { name: '匯入材料' });
        expect(btn).toBeInTheDocument();
        fireEvent.click(btn);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does NOT render button when cta omitted', () => {
        render(<H18EmptyState heading="無 CTA" />);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('applies primary class when cta.variant="primary"', () => {
        render(
            <H18EmptyState
                heading="hero CTA"
                cta={{
                    label: '主動作',
                    onClick: vi.fn(),
                    variant: 'primary',
                }}
            />,
        );
        const btn = screen.getByRole('button', { name: '主動作' });
        // CSS Modules transform class names; we check that *some* class
        // contains 'primary' (the bare token, since CSS modules typically
        // produce names like `_primary_abc123` or, in test mode, the
        // unhashed source name).
        const classList = btn.className.split(/\s+/);
        expect(
            classList.some((c) => c === 'primary' || c.includes('primary')),
        ).toBe(true);
    });

    it('does NOT apply primary class when variant="secondary" (default)', () => {
        render(
            <H18EmptyState
                heading="secondary CTA"
                cta={{
                    label: '次動作',
                    onClick: vi.fn(),
                    variant: 'secondary',
                }}
            />,
        );
        const btn = screen.getByRole('button', { name: '次動作' });
        const classList = btn.className.split(/\s+/);
        // No class should have the token 'primary' as a stand-alone segment
        expect(
            classList.some((c) => c === 'primary' || c.endsWith('_primary')),
        ).toBe(false);
    });

    it('uses role="status" for screen-reader friendliness', () => {
        render(<H18EmptyState heading="a11y check" />);
        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('icon wrapper has aria-hidden so screen readers skip the decorative icon', () => {
        render(
            <H18EmptyState
                icon={<svg data-testid="empty-icon" />}
                heading="aria check"
            />,
        );
        const iconEl = screen.getByTestId('empty-icon');
        const wrapper = iconEl.parentElement;
        expect(wrapper).not.toBeNull();
        // React renders the boolean `aria-hidden` attribute as the string "true"
        expect(wrapper).toHaveAttribute('aria-hidden');
    });

    it('renders all four parts together (icon + heading + description + cta)', () => {
        const onClick = vi.fn();
        render(
            <H18EmptyState
                icon={<svg data-testid="all-icon" />}
                heading="combo heading"
                description="combo description"
                cta={{ label: 'combo cta', onClick, variant: 'primary' }}
            />,
        );
        expect(screen.getByTestId('all-icon')).toBeInTheDocument();
        expect(screen.getByText('combo heading')).toBeInTheDocument();
        expect(screen.getByText('combo description')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'combo cta' }),
        ).toBeInTheDocument();
    });
});
