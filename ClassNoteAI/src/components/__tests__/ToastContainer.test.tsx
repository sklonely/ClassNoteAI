/**
 * ToastContainer · v0.7.0 H18 重做
 *
 * 行為測試：
 *   - 整合 toastService API (subscribe/pauseAll/resumeAll/dismiss)
 *   - card vs typewriter style 分流渲染
 *   - countdown bar sticky vs 動畫
 *   - hover 觸發 pause/resume
 *
 * 不測：
 *   - 實際 CSS 樣式呈現 (jsdom 沒 layout)
 *   - 實際倒數動畫進度
 *   - 色彩 / dark mode 對比
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ToastContainer from '../ToastContainer';
import { toastService } from '../../services/toastService';

beforeEach(() => {
  toastService.clear();
});

afterEach(() => {
  cleanup();
  toastService.clear();
});

describe('ToastContainer · empty state', () => {
  it('renders nothing when no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ToastContainer · card style (default)', () => {
  it('renders message and detail', () => {
    render(<ToastContainer />);
    act(() => { toastService.success('儲存成功', 'ML · L13'); });
    expect(screen.getByText('儲存成功')).toBeInTheDocument();
    expect(screen.getByText('ML · L13')).toBeInTheDocument();
  });

  it('shows correct icon for each type', () => {
    render(<ToastContainer />);
    act(() => {
      toastService.success('a');
      toastService.error('b');
      toastService.warning('c');
      toastService.info('d');
    });
    expect(screen.getByText('✓')).toBeInTheDocument(); // success
    expect(screen.getByText('✕', { selector: 'span' })).toBeInTheDocument(); // error icon (not dismiss button)
    expect(screen.getByText('⚠')).toBeInTheDocument();
    expect(screen.getByText('ⓘ')).toBeInTheDocument();
  });

  it('dismiss button calls toastService.dismiss', async () => {
    const user = userEvent.setup();
    render(<ToastContainer />);
    let id = 0;
    act(() => { id = toastService.success('to be removed'); });
    expect(screen.queryByText('to be removed')).toBeInTheDocument();

    const dismissBtn = screen.getByLabelText('關閉通知');
    await user.click(dismissBtn);
    expect(screen.queryByText('to be removed')).not.toBeInTheDocument();
    // dismiss called → service no longer has toast
    expect(toastService['toasts' as keyof typeof toastService]).not.toContainEqual(
      expect.objectContaining({ id }),
    );
  });

  it('renders countdown bar with animationDuration matching durationMs', () => {
    render(<ToastContainer />);
    act(() => { toastService.show({ message: 'm', durationMs: 3000 }); });
    const bar = screen.getByTestId('countdown-bar');
    const fill = bar.firstChild as HTMLElement;
    expect(fill.style.animationDuration).toBe('3000ms');
  });

  it('renders countdown bar with sticky modifier when durationMs=0', () => {
    render(<ToastContainer />);
    act(() => { toastService.show({ message: 'sticky', durationMs: 0 }); });
    const bar = screen.getByTestId('countdown-bar');
    const fill = bar.firstChild as HTMLElement;
    // sticky → no animationDuration set
    expect(fill.style.animationDuration).toBe('');
    // sticky modifier class applied (CSS Modules hash, but class list contains it)
    expect(fill.className).toMatch(/barSticky/);
  });
});

describe('ToastContainer · hover pause behavior', () => {
  it('pauses toast service on mouse enter, resumes on leave', async () => {
    const pauseSpy = vi.spyOn(toastService, 'pauseAll');
    const resumeSpy = vi.spyOn(toastService, 'resumeAll');
    const user = userEvent.setup();

    render(<ToastContainer />);
    act(() => { toastService.success('hover me'); });
    const toast = screen.getByTestId('toast');
    const container = toast.parentElement!;

    await user.hover(container);
    expect(pauseSpy).toHaveBeenCalled();

    await user.unhover(container);
    expect(resumeSpy).toHaveBeenCalled();
  });

  it('countdown bar animation paused when hovered', async () => {
    const user = userEvent.setup();
    render(<ToastContainer />);
    act(() => { toastService.show({ message: 'pausable', durationMs: 5000 }); });

    const bar = screen.getByTestId('countdown-bar');
    const fill = bar.firstChild as HTMLElement;
    expect(fill.style.animationPlayState).toBe('running');

    const container = screen.getByTestId('toast').parentElement!;
    await user.hover(container);
    expect(fill.style.animationPlayState).toBe('paused');

    await user.unhover(container);
    expect(fill.style.animationPlayState).toBe('running');
  });
});

describe('ToastContainer · typewriter style', () => {
  it('renders timestamp + message in mono format', () => {
    render(<ToastContainer toastStyle="typewriter" />);
    act(() => { toastService.success('備份完成'); });
    expect(screen.getByText('備份完成')).toBeInTheDocument();
    // [HH:MM:SS] format somewhere in DOM
    const timestamp = document.body.textContent?.match(/\[\d{2}:\d{2}:\d{2}\]/);
    expect(timestamp).not.toBeNull();
  });

  it('uses $ icon for info type in typewriter mode', () => {
    render(<ToastContainer toastStyle="typewriter" />);
    act(() => { toastService.info('test'); });
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('still has dismiss button + countdown bar', async () => {
    const user = userEvent.setup();
    render(<ToastContainer toastStyle="typewriter" />);
    act(() => { toastService.show({ message: 'tw', durationMs: 3000 }); });
    expect(screen.getByTestId('countdown-bar')).toBeInTheDocument();
    await user.click(screen.getByLabelText('關閉通知'));
    expect(screen.queryByText('tw')).not.toBeInTheDocument();
  });
});

describe('ToastContainer · stack max + multiple toasts', () => {
  it('renders all current toasts simultaneously', () => {
    render(<ToastContainer />);
    act(() => {
      toastService.success('one');
      toastService.warning('two');
      toastService.error('three');
    });
    expect(screen.getAllByTestId('toast')).toHaveLength(3);
  });

  it('removes from DOM after dismiss', async () => {
    const user = userEvent.setup();
    render(<ToastContainer />);
    act(() => {
      toastService.success('one');
      toastService.warning('two');
    });
    expect(screen.getAllByTestId('toast')).toHaveLength(2);

    const dismissButtons = screen.getAllByLabelText('關閉通知');
    await user.click(dismissButtons[0]);
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
  });
});
