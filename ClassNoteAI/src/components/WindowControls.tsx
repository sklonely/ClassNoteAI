/**
 * H18 WindowControls · v0.7.0
 *
 * macOS-style traffic lights：12×12 紅黃綠圓鈕，左 → 右為
 * 關閉 / 最小化 / 最大化。預設呼叫 Tauri webviewWindow API；
 * 可由 props (`onClose`, `onMinimize`, `onMaximize`) 覆寫供測試或
 * 自訂行為使用。
 *
 * 使用情境：
 *   - 嵌入 H18TopBar 左側
 *   - 對應 tauri.conf.json `decorations: false` (TopBar step 才會
 *     真的 flip，本 component 先做出來、capability 加好)
 *   - macOS 上 close 通常是 hide 不 quit；目前直接 close()，待用戶
 *     回饋是否要 hide-on-close
 */

import s from './WindowControls.module.css';

export interface WindowControlsProps {
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
}

const callTauri = (method: 'close' | 'minimize' | 'toggleMaximize') => {
  import('@tauri-apps/api/webviewWindow')
    .then(({ getCurrentWebviewWindow }) => {
      const win = getCurrentWebviewWindow();
      return win[method]();
    })
    .catch(() => {});
};

export default function WindowControls({ onClose, onMinimize, onMaximize }: WindowControlsProps) {
  const handleClose = onClose ?? (() => callTauri('close'));
  const handleMinimize = onMinimize ?? (() => callTauri('minimize'));
  const handleMaximize = onMaximize ?? (() => callTauri('toggleMaximize'));

  return (
    <div className={s.group}>
      <button
        type="button"
        className={`${s.btn} ${s.btnClose}`}
        title="關閉視窗"
        aria-label="關閉視窗"
        onClick={handleClose}
      >
        <svg
          className={s.glyph}
          width="8"
          height="8"
          viewBox="0 0 8 8"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          aria-hidden
        >
          <path d="M2 2 L6 6" />
          <path d="M6 2 L2 6" />
        </svg>
      </button>

      <button
        type="button"
        className={`${s.btn} ${s.btnMin}`}
        title="最小化"
        aria-label="最小化"
        onClick={handleMinimize}
      >
        <svg
          className={s.glyph}
          width="8"
          height="8"
          viewBox="0 0 8 8"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          aria-hidden
        >
          <path d="M1.5 4 L6.5 4" />
        </svg>
      </button>

      <button
        type="button"
        className={`${s.btn} ${s.btnMax}`}
        title="最大化"
        aria-label="最大化"
        onClick={handleMaximize}
      >
        <svg
          className={s.glyph}
          width="8"
          height="8"
          viewBox="0 0 8 8"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          aria-hidden
        >
          <path d="M2 2 L6 2 L6 6 L2 6 Z" />
        </svg>
      </button>
    </div>
  );
}
