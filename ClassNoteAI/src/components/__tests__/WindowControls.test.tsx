/**
 * WindowControls · v0.7.0 H18
 *
 * macOS-style traffic lights，紅黃綠三鈕。
 *
 * 行為測試：
 *   - 三鈕渲染 (label: 關閉 / 最小化 / 最大化)
 *   - props 覆寫的 onClose/onMinimize/onMaximize 被呼叫
 *   - 預設情況下呼叫 Tauri webviewWindow API (close/minimize/toggleMaximize)
 *   - 鍵盤焦點 / aria-label 正確
 *
 * 不測：hover 顯示 glyph (jsdom 無 hover 樣式)、實際視窗動作。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const closeMock = vi.fn(() => Promise.resolve());
const minimizeMock = vi.fn(() => Promise.resolve());
const toggleMaximizeMock = vi.fn(() => Promise.resolve());

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    close: closeMock,
    minimize: minimizeMock,
    toggleMaximize: toggleMaximizeMock,
  }),
}));

import WindowControls from '../WindowControls';

beforeEach(() => {
  closeMock.mockClear();
  minimizeMock.mockClear();
  toggleMaximizeMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('WindowControls · render', () => {
  it('renders three traffic-light buttons with aria-labels', () => {
    render(<WindowControls />);
    expect(screen.getByRole('button', { name: '關閉視窗' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument();
  });

  it('orders buttons close/min/max (left to right)', () => {
    const { container } = render(<WindowControls />);
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAccessibleName('關閉視窗');
    expect(buttons[1]).toHaveAccessibleName('最小化');
    expect(buttons[2]).toHaveAccessibleName('最大化');
  });
});

describe('WindowControls · prop callbacks', () => {
  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<WindowControls onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: '關閉視窗' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // when prop callback supplied, Tauri default is bypassed
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('calls onMinimize when minimize button clicked', async () => {
    const user = userEvent.setup();
    const onMinimize = vi.fn();
    render(<WindowControls onMinimize={onMinimize} />);
    await user.click(screen.getByRole('button', { name: '最小化' }));
    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(minimizeMock).not.toHaveBeenCalled();
  });

  it('calls onMaximize when maximize button clicked', async () => {
    const user = userEvent.setup();
    const onMaximize = vi.fn();
    render(<WindowControls onMaximize={onMaximize} />);
    await user.click(screen.getByRole('button', { name: '最大化' }));
    expect(onMaximize).toHaveBeenCalledTimes(1);
    expect(toggleMaximizeMock).not.toHaveBeenCalled();
  });
});

describe('WindowControls · default Tauri behavior', () => {
  it('calls webviewWindow.close() when no onClose prop supplied', async () => {
    const user = userEvent.setup();
    render(<WindowControls />);
    await user.click(screen.getByRole('button', { name: '關閉視窗' }));
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('calls webviewWindow.minimize() when no onMinimize prop supplied', async () => {
    const user = userEvent.setup();
    render(<WindowControls />);
    await user.click(screen.getByRole('button', { name: '最小化' }));
    expect(minimizeMock).toHaveBeenCalledTimes(1);
  });

  it('calls webviewWindow.toggleMaximize() when no onMaximize prop supplied', async () => {
    const user = userEvent.setup();
    render(<WindowControls />);
    await user.click(screen.getByRole('button', { name: '最大化' }));
    expect(toggleMaximizeMock).toHaveBeenCalledTimes(1);
  });

  it('swallows Tauri errors (no unhandled rejection)', async () => {
    const user = userEvent.setup();
    closeMock.mockImplementationOnce(() => Promise.reject(new Error('fail')));
    render(<WindowControls />);
    await user.click(screen.getByRole('button', { name: '關閉視窗' }));
    // microtask flush
    await new Promise((r) => setTimeout(r, 0));
    // No assertion needed — if rejection unhandled, test runner would flag.
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
