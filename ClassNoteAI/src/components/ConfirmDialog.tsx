/**
 * H18 ConfirmDialog · v0.7.0
 *
 * Mounted once at App root，subscribes to confirmService。當任何
 * caller await `confirmService.ask({...})`，這裡 render 一個 backdrop
 * + card 詢問使用者。
 *
 * Resolve paths:
 *   - 「確定」 button / Enter key  → resolve(true)
 *   - 「取消」 button / Escape / 背景 click → resolve(false)
 *
 * variant 'danger': 標題前 ⚠ icon + 確定按鈕 #e8412e 紅，給「永久
 * 刪除」「reset 資料」這類不可逆動作用。
 */

import { useEffect, useState } from 'react';
import { confirmService } from '../services/confirmService';
import s from './ConfirmDialog.module.css';

export default function ConfirmDialog() {
  const [active, setActive] = useState(confirmService.current());

  useEffect(() => confirmService.subscribe(setActive), []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        confirmService.dismiss();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        confirmService.accept();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active?.id]);

  if (!active) return null;

  const isDanger = active.variant === 'danger';

  return (
    <div
      className={s.backdrop}
      data-testid="confirm-backdrop"
      onClick={() => confirmService.dismiss()}
      role="presentation"
    >
      <div
        className={s.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="h18-cfm-title"
      >
        <div className={s.titleRow}>
          {isDanger && <span className={s.dangerIcon} aria-hidden>⚠</span>}
          <h2 id="h18-cfm-title" className={s.title}>{active.title}</h2>
        </div>

        {active.message && (
          <div className={s.message}>{active.message}</div>
        )}

        <div className={s.actions}>
          <button
            type="button"
            className={s.btnCancel}
            onClick={() => confirmService.dismiss()}
          >
            {active.cancelLabel ?? '取消'}
          </button>
          <button
            type="button"
            className={`${s.btnConfirm} ${isDanger ? s.danger : ''}`}
            onClick={() => confirmService.accept()}
            autoFocus
          >
            {active.confirmLabel ?? '確定'}
          </button>
        </div>

        <div className={s.kbdHints}>
          <span><b>ESC</b> 取消</span>
          <span><b>↵</b> 確認</span>
        </div>
      </div>
    </div>
  );
}
