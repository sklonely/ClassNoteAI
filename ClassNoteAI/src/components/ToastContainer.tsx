/**
 * H18 ToastContainer · v0.7.0
 *
 * 右下角通知系統。Mount 一次在 App root，所有程式碼用
 * `toastService.success('...')` 等 API post toast。
 *
 * 視覺有兩種 style，由 prop `toastStyle` 控制（Phase 2 會接到
 * AppSettings.appearance.toastStyle）：
 *   - card (預設) — H18 標準通知卡 + 左 3px 色條 + 倒數 bar
 *   - typewriter  — 復古打字機 mono + [HH:MM:SS] 時戳 + ↳ detail
 *
 * Hover 整個 container 會 toastService.pauseAll() (停 timer)，鬆開
 * resumeAll() — 倒數 bar 同步透過 animation-play-state pause。
 *
 * Type 色 (success/error) dark mode 用設計既有 lightened 課程色，
 * 避免太刺眼。
 */

import { useEffect, useState } from 'react';
import {
    toastService,
    type Toast,
    type ToastType,
    type ToastAction,
} from '../services/toastService';
import s from './ToastContainer.module.css';

/**
 * Resolve a toast action to a concrete handler. Callback wins over
 * navRequest; navRequest dispatches a custom event that H18DeepApp
 * subscribes to (services don't need a React/nav reference).
 */
function runToastAction(action: ToastAction) {
    if (action.onClick) {
        try {
            action.onClick();
        } catch (err) {
            console.warn('[ToastContainer] action.onClick threw:', err);
        }
        return;
    }
    if (action.navRequest) {
        window.dispatchEvent(
            new CustomEvent('classnote-h18-nav-request', {
                detail: { target: action.navRequest },
            }),
        );
    }
}

function defaultActionLabel(action?: ToastAction): string | null {
    if (!action) return null;
    if (action.label) return action.label;
    if (action.navRequest) {
        switch (action.navRequest.kind) {
            case 'home':
                return '前往首頁';
            case 'profile':
                return '前往設定';
            case 'course':
                return '查看課程';
            case 'course-edit':
                return '編輯課程';
        }
    }
    return '前往修正';
}

type ToastStyle = 'card' | 'typewriter';

interface Props {
  toastStyle?: ToastStyle;
}

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ⓘ',
};

const ICONS_TYPEWRITER: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: '$',
};

const TYPE_CLASS: Record<ToastType, string> = {
  success: s.typeSuccess,
  error: s.typeError,
  warning: s.typeWarning,
  info: s.typeInfo,
};

export default function ToastContainer({ toastStyle: toastStyleProp }: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hovered, setHovered] = useState(false);

  // cp75: read appearance.toastStyle from settings if no explicit prop.
  // The Phase 2 TODO finally wired up — before this, the user's pick in
  // PAppearance was a dead toggle (the App.tsx mounts both render
  // <ToastContainer /> with no prop, defaulting forever to 'card').
  const [styleFromSettings, setStyleFromSettings] = useState<
    ToastStyle | undefined
  >(undefined);
  useEffect(() => {
    let alive = true;
    const sync = async () => {
      try {
        const { storageService } = await import(
          '../services/storageService'
        );
        const settings = await storageService.getAppSettings();
        if (alive) {
          setStyleFromSettings(settings?.appearance?.toastStyle);
        }
      } catch {
        // best-effort — fall back to default 'card' below
      }
    };
    void sync();
    const onChange = () => void sync();
    window.addEventListener('classnote-settings-changed', onChange);
    return () => {
      alive = false;
      window.removeEventListener('classnote-settings-changed', onChange);
    };
  }, []);

  const toastStyle: ToastStyle = toastStyleProp ?? styleFromSettings ?? 'card';

  useEffect(() => {
    return toastService.subscribe(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className={s.container}
      onMouseEnter={() => {
        setHovered(true);
        toastService.pauseAll();
      }}
      onMouseLeave={() => {
        setHovered(false);
        toastService.resumeAll();
      }}
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) =>
        toastStyle === 'typewriter' ? (
          <ToastItemTypewriter key={t.id} toast={t} hovered={hovered} />
        ) : (
          <ToastItemCard key={t.id} toast={t} hovered={hovered} />
        ),
      )}
    </div>
  );
}

interface ItemProps {
  toast: Toast;
  hovered: boolean;
}

function CountdownBar({ toast, hovered }: ItemProps) {
  const sticky = !toast.durationMs || toast.durationMs <= 0;
  return (
    <div className={s.bar} data-testid="countdown-bar">
      <div
        className={`${s.barFill} ${sticky ? s.barSticky : ''}`}
        style={{
          animationDuration: sticky ? undefined : `${toast.durationMs}ms`,
          animationPlayState: hovered ? 'paused' : 'running',
        }}
      />
    </div>
  );
}

function ToastItemCard({ toast, hovered }: ItemProps) {
  const actionLabel = defaultActionLabel(toast.action);
  const isActionable = !!toast.action;

  const handleActivate = () => {
    if (toast.action) {
      runToastAction(toast.action);
      toastService.dismiss(toast.id);
    }
  };

  return (
    <div
      className={`${s.toastCard} ${TYPE_CLASS[toast.type]} ${isActionable ? s.toastCardActionable : ''}`}
      role={isActionable ? 'button' : 'status'}
      tabIndex={isActionable ? 0 : undefined}
      onClick={isActionable ? handleActivate : undefined}
      onKeyDown={
        isActionable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleActivate();
              }
            }
          : undefined
      }
      data-testid="toast"
    >
      <div className={s.stripe} />
      <div className={s.bodyCard}>
        <span className={s.iconCard}>{ICONS[toast.type]}</span>
        <div className={s.text}>
          <div className={s.message}>{toast.message}</div>
          {toast.detail && <div className={s.detail}>{toast.detail}</div>}
          {isActionable && actionLabel && (
            <div className={s.actionLine}>
              <span className={s.actionLabel}>{actionLabel}</span>
              <span className={s.actionArrow} aria-hidden>
                →
              </span>
            </div>
          )}
        </div>
        <button
          className={s.dismiss}
          onClick={(e) => {
            e.stopPropagation();
            toastService.dismiss(toast.id);
          }}
          aria-label="關閉通知"
          title="關閉"
        >
          ✕
        </button>
      </div>
      <CountdownBar toast={toast} hovered={hovered} />
    </div>
  );
}

function ToastItemTypewriter({ toast, hovered }: ItemProps) {
  // 從 toast.at (epoch ms) 算 HH:MM:SS
  const ts = new Date(toast.at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const tsStr = `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`;

  const actionLabel = defaultActionLabel(toast.action);
  const isActionable = !!toast.action;

  const handleActivate = () => {
    if (toast.action) {
      runToastAction(toast.action);
      toastService.dismiss(toast.id);
    }
  };

  return (
    <div
      className={`${s.toastTypewriter} ${TYPE_CLASS[toast.type]} ${isActionable ? s.toastCardActionable : ''}`}
      role={isActionable ? 'button' : 'status'}
      tabIndex={isActionable ? 0 : undefined}
      onClick={isActionable ? handleActivate : undefined}
      onKeyDown={
        isActionable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleActivate();
              }
            }
          : undefined
      }
      data-testid="toast"
    >
      <span className={s.iconTypewriter}>{ICONS_TYPEWRITER[toast.type]}</span>
      <div className={s.bodyTypewriter}>
        <div className={s.lineTypewriter}>
          <span className={s.timestamp}>[{tsStr}]</span>
          <span className={s.messageTypewriter}>{toast.message}</span>
        </div>
        {toast.detail && (
          <div className={s.detailTypewriter}>
            <span className={s.detailArrow}>↳</span>
            {toast.detail}
          </div>
        )}
        {isActionable && actionLabel && (
          <div className={s.actionLine}>
            <span className={s.actionLabel}>{actionLabel}</span>
            <span className={s.actionArrow} aria-hidden>
              →
            </span>
          </div>
        )}
      </div>
      <button
        className={s.dismiss}
        onClick={(e) => {
          e.stopPropagation();
          toastService.dismiss(toast.id);
        }}
        aria-label="關閉通知"
        title="關閉"
      >
        ✕
      </button>
      <CountdownBar toast={toast} hovered={hovered} />
    </div>
  );
}
