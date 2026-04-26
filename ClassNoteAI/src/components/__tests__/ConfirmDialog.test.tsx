/**
 * ConfirmDialog · v0.7.0 H18 重做
 *
 * 行為測試：
 *   - 整合 confirmService API (ask Promise / accept / dismiss / subscribe)
 *   - ESC / Enter 鍵盤
 *   - 背景 click 取消
 *   - variant 'danger' 視覺差異
 *
 * 不測：實際 backdrop blur / animation / 色彩 (jsdom 限制)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog from '../ConfirmDialog';
import { confirmService } from '../../services/confirmService';

beforeEach(() => {
  // 確保 service 沒留 pending request
  if (confirmService.current()) confirmService.dismiss();
});

afterEach(() => {
  cleanup();
  if (confirmService.current()) confirmService.dismiss();
});

describe('ConfirmDialog · empty state', () => {
  it('renders nothing when no active request', () => {
    const { container } = render(<ConfirmDialog />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ConfirmDialog · basic render', () => {
  it('renders title and message when service has active request', async () => {
    render(<ConfirmDialog />);
    let promise: Promise<boolean>;
    act(() => {
      promise = confirmService.ask({
        title: '清除字幕？',
        message: '此動作不會刪除資料庫紀錄。',
      });
    });

    expect(screen.getByText('清除字幕？')).toBeInTheDocument();
    expect(screen.getByText('此動作不會刪除資料庫紀錄。')).toBeInTheDocument();

    // Clean up promise
    act(() => { confirmService.dismiss(); });
    await expect(promise!).resolves.toBe(false);
  });

  it('uses default labels (確定 / 取消) when not provided', async () => {
    render(<ConfirmDialog />);
    act(() => {
      confirmService.ask({ title: 't', message: 'm' });
    });
    expect(screen.getByRole('button', { name: '確定' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
  });

  it('uses custom labels when provided', () => {
    render(<ConfirmDialog />);
    act(() => {
      confirmService.ask({
        title: 't', message: 'm',
        confirmLabel: '永久刪除', cancelLabel: '保留',
      });
    });
    expect(screen.getByRole('button', { name: '永久刪除' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保留' })).toBeInTheDocument();
  });
});

describe('ConfirmDialog · resolve flow', () => {
  it('confirm button resolves promise to true', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    let result: boolean | undefined;
    act(() => {
      confirmService.ask({ title: 't', message: 'm' }).then((v) => { result = v; });
    });
    await user.click(screen.getByRole('button', { name: '確定' }));
    // Wait for promise to flush
    await new Promise((r) => setTimeout(r, 0));
    expect(result).toBe(true);
  });

  it('cancel button resolves promise to false', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    let result: boolean | undefined;
    act(() => {
      confirmService.ask({ title: 't', message: 'm' }).then((v) => { result = v; });
    });
    await user.click(screen.getByRole('button', { name: '取消' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(result).toBe(false);
  });

  it('Enter key resolves to true', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    let result: boolean | undefined;
    act(() => {
      confirmService.ask({ title: 't', message: 'm' }).then((v) => { result = v; });
    });
    await user.keyboard('{Enter}');
    await new Promise((r) => setTimeout(r, 0));
    expect(result).toBe(true);
  });

  it('Escape key resolves to false', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    let result: boolean | undefined;
    act(() => {
      confirmService.ask({ title: 't', message: 'm' }).then((v) => { result = v; });
    });
    await user.keyboard('{Escape}');
    await new Promise((r) => setTimeout(r, 0));
    expect(result).toBe(false);
  });

  it('backdrop click resolves to false', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    let result: boolean | undefined;
    act(() => {
      confirmService.ask({ title: 't', message: 'm' }).then((v) => { result = v; });
    });
    // backdrop = the outermost container with role / testid
    const backdrop = screen.getByTestId('confirm-backdrop');
    await user.click(backdrop);
    await new Promise((r) => setTimeout(r, 0));
    expect(result).toBe(false);
  });

  it('clicking inside card does NOT dismiss', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    let result: boolean | undefined;
    act(() => {
      confirmService.ask({ title: 't', message: 'm' }).then((v) => { result = v; });
    });
    await user.click(screen.getByText('m'));
    await new Promise((r) => setTimeout(r, 0));
    expect(result).toBeUndefined(); // promise still pending
    act(() => { confirmService.dismiss(); }); // cleanup
  });
});

describe('ConfirmDialog · danger variant', () => {
  it('shows ⚠ icon prefix in title for danger variant', () => {
    render(<ConfirmDialog />);
    act(() => {
      confirmService.ask({ title: 'Delete forever', message: 'm', variant: 'danger' });
    });
    // ⚠ shows as text node before title
    expect(screen.getByText('⚠')).toBeInTheDocument();
  });

  it('confirm button has danger class for danger variant', () => {
    render(<ConfirmDialog />);
    act(() => {
      confirmService.ask({ title: 't', message: 'm', variant: 'danger' });
    });
    const confirmBtn = screen.getByRole('button', { name: '確定' });
    expect(confirmBtn.className).toMatch(/danger/);
  });

  it('default variant has no danger class', () => {
    render(<ConfirmDialog />);
    act(() => {
      confirmService.ask({ title: 't', message: 'm' });
    });
    const confirmBtn = screen.getByRole('button', { name: '確定' });
    expect(confirmBtn.className).not.toMatch(/danger/);
    // Also no ⚠ icon shown
    expect(screen.queryByText('⚠')).not.toBeInTheDocument();
  });
});

describe('ConfirmDialog · keyboard hints', () => {
  it('shows ESC and ↵ hints in footer', () => {
    render(<ConfirmDialog />);
    act(() => {
      confirmService.ask({ title: 't', message: 'm' });
    });
    expect(screen.getByText(/ESC/)).toBeInTheDocument();
    expect(screen.getByText(/↵/)).toBeInTheDocument();
  });
});
