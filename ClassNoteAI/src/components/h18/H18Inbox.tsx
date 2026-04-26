/**
 * H18Inbox · v0.7.0 Phase 6.2 — 留白版
 *
 * 對應 docs/design/h18-deep/h18-inbox-preview.jsx L78-135.
 * P6.2 規則：reminders schema 沒做 → 渲染 chrome (filter pills +
 * group headings 計數 0) + 中央 empty state。
 *
 * v0.7.x 後加 reminders 表時把 prop `reminders` 接進來，replace empty。
 */

import s from './H18Inbox.module.css';

export interface H18InboxProps {
    /** 真做時填入；P6.2 全為空 */
    counts?: {
        all?: number;
        urgent?: number;
        said?: number;
        hw?: number;
        grade?: number;
    };
}

const DEFAULT_COUNTS = { all: 0, urgent: 0, said: 0, hw: 0, grade: 0 };

export default function H18Inbox({ counts = DEFAULT_COUNTS }: H18InboxProps) {
    const c = { ...DEFAULT_COUNTS, ...counts };
    const filters = [
        { l: `全部 · ${c.all}`, key: 'all', active: true },
        { l: `高優 · ${c.urgent}`, key: 'urgent' },
        { l: `老師說 · ${c.said}`, key: 'said' },
        { l: `作業 · ${c.hw}`, key: 'hw' },
        { l: `成績 · ${c.grade}`, key: 'grade' },
    ];
    const groups = [
        { key: 'today', label: '今天到期', count: 0 },
        { key: 'week', label: '本週', count: 0 },
        { key: 'said', label: '老師說過', count: 0 },
    ];

    return (
        <div className={s.inbox}>
            <div className={s.filters}>
                {filters.map((f) => (
                    <button
                        type="button"
                        key={f.key}
                        className={`${s.pill} ${f.active ? s.pillActive : ''}`}
                        title={f.l}
                    >
                        {f.l}
                    </button>
                ))}
                <button type="button" className={s.sort} title="排序">
                    排序：優先度 ▾
                </button>
            </div>

            <div className={s.body}>
                {groups.map((g) => (
                    <div key={g.key}>
                        <div className={s.groupHead}>
                            <span>{g.label}</span>
                            <span className={s.groupCount}>{g.count}</span>
                            <div className={s.groupRule} />
                        </div>
                    </div>
                ))}

                <div className={s.empty}>
                    <span className={s.emptyIcon}>✉</span>
                    <p className={s.emptyTitle}>Inbox 待 reminders 後端</p>
                    <p className={s.emptyHint}>
                        作業、老師說、公告、成績、待辦 — 規格定後從這裡進來。
                        現在沒有 reminders 表，先當佔位。
                    </p>
                    <div className={s.emptyTag}>P6.2 · 留白</div>
                </div>
            </div>
        </div>
    );
}
