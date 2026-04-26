/**
 * TopBar · v0.7.0 H18
 *
 * Chrome shell：WindowControls (left) + brand + 中央 nav 槽 +
 * right actions 槽。本身不擁有 nav 邏輯，由 caller (MainWindow) 餵
 * children — 確保改視覺不破壞既有導覽。
 *
 * 行為測試：
 *   - render brand / nav / rightActions slots
 *   - showWindowControls 預設 false (漸進式 migration，視窗 chrome 還是
 *     用系統的)，true 時 mount H18 traffic lights
 *   - 有 data-tauri-drag-region attr
 *   - dense 模式套不同 padding class
 *   - role="banner" 語意
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    close: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
  }),
}));

import TopBar from '../TopBar';

afterEach(() => {
  cleanup();
});

describe('TopBar · slots', () => {
  it('renders brand slot', () => {
    render(<TopBar brand={<span data-testid="brand">ClassNote AI</span>} />);
    expect(screen.getByTestId('brand')).toBeInTheDocument();
  });

  it('renders nav slot', () => {
    render(
      <TopBar
        brand={<span>brand</span>}
        nav={<button data-testid="nav-btn">Home</button>}
      />,
    );
    expect(screen.getByTestId('nav-btn')).toBeInTheDocument();
  });

  it('renders rightActions slot', () => {
    render(
      <TopBar
        brand={<span>brand</span>}
        rightActions={<button data-testid="action">Profile</button>}
      />,
    );
    expect(screen.getByTestId('action')).toBeInTheDocument();
  });
});

describe('TopBar · WindowControls toggle', () => {
  it('does NOT render WindowControls by default', () => {
    render(<TopBar brand={<span>b</span>} />);
    expect(screen.queryByRole('button', { name: '關閉視窗' })).not.toBeInTheDocument();
  });

  it('renders WindowControls when showWindowControls=true', () => {
    render(<TopBar brand={<span>b</span>} showWindowControls />);
    expect(screen.getByRole('button', { name: '關閉視窗' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument();
  });
});

describe('TopBar · drag region', () => {
  it('exposes data-tauri-drag-region on the chrome bar', () => {
    const { container } = render(<TopBar brand={<span>b</span>} />);
    const bar = container.querySelector('[data-tauri-drag-region]');
    expect(bar).not.toBeNull();
  });
});

describe('TopBar · semantics', () => {
  it('uses role=banner for accessibility', () => {
    render(<TopBar brand={<span>b</span>} />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});

describe('TopBar · density', () => {
  it('applies dense class when dense=true', () => {
    const { container } = render(<TopBar brand={<span>b</span>} dense />);
    const bar = container.querySelector('header');
    expect(bar?.className).toMatch(/dense/);
  });

  it('does not apply dense class by default', () => {
    const { container } = render(<TopBar brand={<span>b</span>} />);
    const bar = container.querySelector('header');
    expect(bar?.className).not.toMatch(/dense/);
  });
});
