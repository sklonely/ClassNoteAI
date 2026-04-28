/**
 * CanvasItemPreviewModal · v0.7.x
 *
 * 點 H18Preview 的 Canvas 公告 / 行事曆條目時跳出來的小視窗，先把
 * 抓到的內容（標題、作者、時間、HTML / 描述）給使用者預覽，避免一點就
 * 直接離開 app 跳到 Canvas 網頁。
 *
 * 兩種 mode 同一個 modal：
 *  - announcement: Atom feed entry → 含 rich HTML body
 *  - event: ICS VEVENT → 含 plain DESCRIPTION + 可能的 X-ALT-DESC HTML
 *
 * 底部有「在 Canvas 開啟」CTA，按下才真的呼叫 openUrl 跳瀏覽器。
 */

import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type {
    CanvasAnnouncement,
    CanvasCalendarEvent,
} from '../../services/canvasFeedService';
import { safeHtml } from '../../utils/safeHtml';
import s from './CanvasItemPreviewModal.module.css';

export type CanvasPreviewItem =
    | { kind: 'announcement'; data: CanvasAnnouncement }
    | { kind: 'event'; data: CanvasCalendarEvent };

export interface CanvasItemPreviewModalProps {
    item: CanvasPreviewItem;
    /** 課程顯示色，header 那條 stripe 用。 */
    accent?: string;
    /** 課名（顯示在 eyebrow，給 context；optional）。 */
    courseTitle?: string;
    onClose: () => void;
}

/* ────────── time formatting ────────── */

function formatAbsoluteTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function formatRelativeTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const futureMs = -diffMs;
    if (futureMs > 0) {
        // upcoming
        const m = Math.round(futureMs / (1000 * 60));
        if (m < 60) return `${m} 分鐘後`;
        const h = Math.round(m / 60);
        if (h < 24) return `${h} 小時後`;
        const days = Math.round(h / 24);
        if (days < 30) return `${days} 天後`;
        return formatAbsoluteTime(iso);
    }
    const m = Math.floor(diffMs / (1000 * 60));
    if (m < 1) return '剛剛';
    if (m < 60) return `${m} 分鐘前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小時前`;
    const days = Math.floor(h / 24);
    if (days < 30) return `${days} 天前`;
    return formatAbsoluteTime(iso);
}

function formatDueRange(ev: CanvasCalendarEvent): string {
    if (ev.isAllDay) {
        return `${formatAbsoluteTime(ev.startAt).slice(0, 10)}（整天）`;
    }
    return `${formatAbsoluteTime(ev.startAt)}（${formatRelativeTime(ev.startAt)}）`;
}

const EVENT_TYPE_LABEL: Record<CanvasCalendarEvent['type'], string> = {
    assignment: '作業',
    quiz: '小考',
    calendar_event: '行事曆事件',
    other: '事件',
};

/* ────────── component ────────── */

export default function CanvasItemPreviewModal({
    item,
    accent,
    courseTitle,
    onClose,
}: CanvasItemPreviewModalProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const externalUrl =
        item.kind === 'announcement' ? item.data.link : item.data.url;

    /**
     * 在內嵌 HTML 裡點到 <a href> 時，攔截 → 用 Tauri openUrl 開外部瀏覽器，
     * 不要用 webview 自己跳走。modal 內呼叫的兩條 path（內嵌 + 底部 CTA）
     * 都走這支。
     */
    const handleOpenExternal = (url: string) => {
        void openUrl(url).catch((err) => {
            console.warn('[CanvasItemPreviewModal] openUrl failed:', err);
        });
    };

    const onContentClick = (e: MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
        if (!anchor) return;
        e.preventDefault();
        const href = anchor.getAttribute('href') || '';
        if (!href || href.startsWith('#')) return;
        handleOpenExternal(href);
    };

    const sanitizedHtml = useMemo(() => {
        if (item.kind === 'announcement') return safeHtml(item.data.contentHtml);
        if (item.data.descriptionHtml) return safeHtml(item.data.descriptionHtml);
        return null;
    }, [item]);

    return (
        <div
            className={s.scrim}
            onClick={onClose}
            role="presentation"
        >
            <div
                ref={ref}
                className={s.modal}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={
                    item.kind === 'announcement'
                        ? `公告：${item.data.title}`
                        : `事件：${item.data.title}`
                }
            >
                <div
                    className={s.stripe}
                    style={{ background: accent || 'var(--h18-accent)' }}
                />
                <div className={s.head}>
                    <div className={s.eyebrow}>
                        {item.kind === 'announcement'
                            ? '✦ Canvas 公告'
                            : '⚑ Canvas 事件'}
                        {item.kind === 'event' && (
                            <span className={s.eyebrowTag}>
                                {EVENT_TYPE_LABEL[item.data.type]}
                            </span>
                        )}
                        {courseTitle && (
                            <span className={s.eyebrowCourse}>· {courseTitle}</span>
                        )}
                    </div>
                    <h2 className={s.title}>{item.data.title}</h2>
                    <div className={s.meta}>
                        {item.kind === 'announcement' ? (
                            <>
                                <span className={s.metaAuthor}>{item.data.author}</span>
                                <span className={s.metaDot}>·</span>
                                <span title={formatAbsoluteTime(item.data.publishedAt)}>
                                    {formatRelativeTime(item.data.publishedAt)} ·{' '}
                                    {formatAbsoluteTime(item.data.publishedAt)}
                                </span>
                            </>
                        ) : (
                            <>
                                <span title={`Canvas course_${item.data.canvasCourseId}`}>
                                    截止：{formatDueRange(item.data)}
                                </span>
                            </>
                        )}
                    </div>
                    <button
                        type="button"
                        className={s.close}
                        onClick={onClose}
                        aria-label="關閉"
                        title="關閉 (Esc)"
                    >
                        ✕
                    </button>
                </div>

                <div className={s.body}>
                    {sanitizedHtml ? (
                        <div
                            className={s.htmlBody}
                            onClick={onContentClick}
                            // eslint-disable-next-line react/no-danger
                            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                        />
                    ) : item.kind === 'event' && item.data.description.trim() ? (
                        <div className={s.plainBody}>{item.data.description}</div>
                    ) : (
                        <div className={s.empty}>
                            {item.kind === 'event'
                                ? '這個事件沒有附說明。完整內容點下方按鈕到 Canvas 看。'
                                : '這個公告沒有額外內容。'}
                        </div>
                    )}
                </div>

                <div className={s.foot}>
                    <span className={s.footHint}>
                        {item.kind === 'announcement'
                            ? '上面是 Canvas 公告原文（HTML）。'
                            : item.data.descriptionHtml
                              ? '上面是事件說明的格式化版本。'
                              : '事件內容簡短，到 Canvas 可看完整附件 / 連結。'}
                    </span>
                    <div className={s.footActions}>
                        <button
                            type="button"
                            className={s.btnGhost}
                            onClick={onClose}
                        >
                            關閉
                        </button>
                        <button
                            type="button"
                            className={s.btnPrimary}
                            onClick={() => handleOpenExternal(externalUrl)}
                        >
                            在 Canvas 開啟 ↗
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
