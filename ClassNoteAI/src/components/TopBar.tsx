/**
 * H18 TopBar · v0.7.0
 *
 * Chrome shell — 純 layout、不擁有任何業務邏輯：
 *   left  · (optional) WindowControls + brand
 *   center · nav (caller 餵 children)
 *   right · actions (caller 餵 children)
 *
 * `showWindowControls` 預設 false 讓我們可以漸進式 migration —
 * 還沒 flip `tauri.conf.json` decorations 之前，傳統 OS title bar
 * 仍然在；flip 了之後再開為 true。
 *
 * 整條 bar 預設 data-tauri-drag-region；button 等互動元素需自己
 * 標記 data-tauri-drag-region="false" 以取消拖。
 */

import type { ReactNode } from 'react';
import WindowControls from './WindowControls';
import s from './TopBar.module.css';

export interface TopBarProps {
  brand: ReactNode;
  nav?: ReactNode;
  rightActions?: ReactNode;
  showWindowControls?: boolean;
  dense?: boolean;
}

export default function TopBar({
  brand,
  nav,
  rightActions,
  showWindowControls = false,
  dense = false,
}: TopBarProps) {
  const headerClass = `${s.topbar} ${dense ? s.dense : ''}`.trim();
  return (
    <header className={headerClass} role="banner" data-tauri-drag-region>
      <div className={s.left}>
        {showWindowControls && (
          <>
            <WindowControls />
            <div className={s.brandDivider} aria-hidden />
          </>
        )}
        {brand}
      </div>
      {nav && <div className={s.center}>{nav}</div>}
      {rightActions && <div className={s.right}>{rightActions}</div>}
    </header>
  );
}
