/**
 * CanvasPairingWizard · v0.7.x
 *
 * 把 Canvas 行事曆抓到的課程對應到本機 Course，或建立新本機課，或
 * 標記忽略。一個 modal 一次處理完，不額外彈窗。
 *
 * UX 設計重點：
 *  - 「建立新課程」是 inline — 同一個 modal 裡開個 title 輸入框
 *    （預填 Canvas 全名，使用者可改成 "HCI" 等慣用縮寫），不另外彈
 *    AddCourseDialog；避免「3 門課 = 3 個視窗連續跳」的災難。
 *  - 預設每行 decision 是「稍後再說」(defer) — 使用者只需要動有意願
 *    處理的那幾行；剩下會在 rail 上以虛擬課程占位呈現，之後也可重跑
 *    wizard 處理。
 *  - 一鍵「套用」批次寫入：updateCourse / createCourse / append
 *    ignored_course_ids，全部成功後關閉。
 *
 * 不在這支做：
 *  - 抓 Canvas feed (caller 已抓好傳進來)
 *  - 詳細的 syllabus / PDF / keywords (新建只填 title，使用者之後到
 *    課程編輯再補)
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Course } from '../../types';
import s from './CanvasPairingWizard.module.css';

export interface CanvasPairingWizardProps {
    /** 來自 canvasFeedService.fetchCalendarFeed → .courses 的 list。 */
    canvasCourses: { canvasCourseId: string; fullTitle: string }[];
    /** 本機現有課程（用來提供「對應到」下拉選項 + 標記已配對的 row）。 */
    localCourses: Course[];
    /** AppSettings.integrations.canvas.ignored_course_ids 內容。 */
    ignoredCourseIds: string[];
    onClose: () => void;
    /** 一鍵套用時的 batched write。所有寫入都成功才 onClose。 */
    onCommit: (changes: PairingChanges) => Promise<void>;
}

export interface PairingChanges {
    /** 把現有 Course.canvas_course_id 寫成這個 mapping。 */
    pairExisting: { localCourseId: string; canvasCourseId: string }[];
    /** 建立新課程，title 是使用者輸入（可能改過）。 */
    createNew: { title: string; canvasCourseId: string }[];
    /** 加進忽略清單。 */
    ignore: string[];
}

type Decision =
    | { kind: 'pair'; localCourseId: string }
    | { kind: 'create'; title: string }
    | { kind: 'ignore' }
    | { kind: 'defer' };

const DEFAULT_DECISION: Decision = { kind: 'defer' };

export default function CanvasPairingWizard({
    canvasCourses,
    localCourses,
    ignoredCourseIds,
    onClose,
    onCommit,
}: CanvasPairingWizardProps) {
    const [decisions, setDecisions] = useState<Map<string, Decision>>(() => {
        const m = new Map<string, Decision>();
        for (const c of canvasCourses) m.set(c.canvasCourseId, DEFAULT_DECISION);
        return m;
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Lookup: canvas_course_id → local course already paired
    const alreadyPaired = useMemo(() => {
        const m = new Map<string, Course>();
        for (const c of localCourses) {
            if (c.canvas_course_id) m.set(c.canvas_course_id, c);
        }
        return m;
    }, [localCourses]);

    // Local courses that have NO canvas_course_id yet — selectable in dropdown
    const pairableLocal = useMemo(
        () => localCourses.filter((c) => !c.canvas_course_id),
        [localCourses],
    );

    // What's already used in pending pair decisions (so we can disable in other dropdowns)
    const usedLocalIds = useMemo(() => {
        const used = new Set<string>();
        for (const d of decisions.values()) {
            if (d.kind === 'pair') used.add(d.localCourseId);
        }
        return used;
    }, [decisions]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busy) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, busy]);

    const setDecision = (canvasCourseId: string, d: Decision) => {
        setDecisions((m) => {
            const next = new Map(m);
            next.set(canvasCourseId, d);
            return next;
        });
    };

    // Filter out already paired & ignored — those rows are info-only at top
    const pairedRows = canvasCourses.filter((c) => alreadyPaired.has(c.canvasCourseId));
    const ignoredRows = canvasCourses.filter(
        (c) =>
            !alreadyPaired.has(c.canvasCourseId) &&
            ignoredCourseIds.includes(c.canvasCourseId),
    );
    const todoRows = canvasCourses.filter(
        (c) =>
            !alreadyPaired.has(c.canvasCourseId) &&
            !ignoredCourseIds.includes(c.canvasCourseId),
    );

    // Counts for footer summary
    const counts = { pair: 0, create: 0, ignore: 0, defer: 0 };
    for (const row of todoRows) {
        const d = decisions.get(row.canvasCourseId) ?? DEFAULT_DECISION;
        counts[d.kind]++;
    }
    const hasChanges = counts.pair + counts.create + counts.ignore > 0;

    const handleCommit = async () => {
        if (!hasChanges) {
            onClose();
            return;
        }
        setBusy(true);
        setError(null);
        const changes: PairingChanges = {
            pairExisting: [],
            createNew: [],
            ignore: [],
        };
        for (const row of todoRows) {
            const d = decisions.get(row.canvasCourseId) ?? DEFAULT_DECISION;
            if (d.kind === 'pair') {
                changes.pairExisting.push({
                    localCourseId: d.localCourseId,
                    canvasCourseId: row.canvasCourseId,
                });
            } else if (d.kind === 'create') {
                const title = d.title.trim();
                if (title.length > 0) {
                    changes.createNew.push({ title, canvasCourseId: row.canvasCourseId });
                }
            } else if (d.kind === 'ignore') {
                changes.ignore.push(row.canvasCourseId);
            }
        }
        try {
            await onCommit(changes);
            onClose();
        } catch (err) {
            console.error('[CanvasPairingWizard] commit failed:', err);
            setError(
                (err as Error)?.message || '套用失敗，請查看 console。',
            );
            setBusy(false);
        }
    };

    return (
        <div
            className={s.scrim}
            onClick={() => {
                if (!busy) onClose();
            }}
            role="presentation"
        >
            <div
                className={s.modal}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Canvas 課程配對"
            >
                <div className={s.head}>
                    <div>
                        <div className={s.eyebrow}>CANVAS PAIRING</div>
                        <h2 className={s.title}>Canvas 課程配對</h2>
                        <div className={s.sub}>
                            從你的 Canvas 行事曆找到 {canvasCourses.length} 門課，請決定每門
                            要怎麼處理 — 對應、新建、或忽略。
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className={s.close}
                        disabled={busy}
                        aria-label="關閉"
                    >
                        ✕
                    </button>
                </div>

                <div className={s.body}>
                    {pairedRows.length > 0 && (
                        <Section title="✓ 已對應" muted>
                            {pairedRows.map((row) => {
                                const local = alreadyPaired.get(row.canvasCourseId);
                                return (
                                    <div key={row.canvasCourseId} className={`${s.row} ${s.rowDone}`}>
                                        <div className={s.rowMain}>
                                            <div className={s.rowTitle}>{row.fullTitle}</div>
                                            <div className={s.rowMeta}>
                                                course_{row.canvasCourseId} →{' '}
                                                <strong>{local?.title}</strong>
                                            </div>
                                        </div>
                                        <span className={s.donePill}>已對應</span>
                                    </div>
                                );
                            })}
                        </Section>
                    )}

                    {todoRows.length > 0 && (
                        <Section title={`待處理 · ${todoRows.length}`}>
                            {todoRows.map((row) => {
                                const d = decisions.get(row.canvasCourseId) ?? DEFAULT_DECISION;
                                return (
                                    <PairingRow
                                        key={row.canvasCourseId}
                                        canvasCourse={row}
                                        decision={d}
                                        onChange={(next) => setDecision(row.canvasCourseId, next)}
                                        pairableLocal={pairableLocal}
                                        usedLocalIds={usedLocalIds}
                                    />
                                );
                            })}
                        </Section>
                    )}

                    {ignoredRows.length > 0 && (
                        <Section title={`已忽略 · ${ignoredRows.length}`} muted>
                            {ignoredRows.map((row) => (
                                <div key={row.canvasCourseId} className={`${s.row} ${s.rowIgnored}`}>
                                    <div className={s.rowMain}>
                                        <div className={s.rowTitle}>{row.fullTitle}</div>
                                        <div className={s.rowMeta}>course_{row.canvasCourseId}</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setDecision(row.canvasCourseId, DEFAULT_DECISION)
                                        }
                                        className={s.unignoreBtn}
                                        title="移到待處理"
                                    >
                                        ↻ 取消忽略
                                    </button>
                                </div>
                            ))}
                        </Section>
                    )}

                    {todoRows.length === 0 &&
                        pairedRows.length === 0 &&
                        ignoredRows.length === 0 && (
                            <div className={s.empty}>
                                Canvas 行事曆裡沒找到課程 — 確認 URL 是否正確。
                            </div>
                        )}
                </div>

                <div className={s.foot}>
                    <div className={s.footSummary}>
                        {todoRows.length === 0 ? (
                            <span className={s.footHint}>沒有待處理</span>
                        ) : (
                            <>
                                {counts.pair > 0 && <Chip color="accent">對應 {counts.pair}</Chip>}
                                {counts.create > 0 && <Chip color="accent">新建 {counts.create}</Chip>}
                                {counts.ignore > 0 && <Chip color="muted">忽略 {counts.ignore}</Chip>}
                                {counts.defer > 0 && <Chip color="muted">稍後 {counts.defer}</Chip>}
                            </>
                        )}
                        {error && <span className={s.errorText}>⚠ {error}</span>}
                    </div>
                    <div className={s.footActions}>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            className={s.btnGhost}
                        >
                            稍後再說
                        </button>
                        <button
                            type="button"
                            onClick={handleCommit}
                            disabled={busy || !hasChanges}
                            className={s.btnPrimary}
                        >
                            {busy ? '套用中…' : hasChanges ? '✓ 套用變更' : '無變更'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ─────────────── Section header ─────────────── */
function Section({ title, muted, children }: { title: string; muted?: boolean; children: ReactNode }) {
    return (
        <div className={s.section}>
            <div className={`${s.sectionHead} ${muted ? s.sectionHeadMuted : ''}`}>
                {title}
            </div>
            <div className={s.sectionBody}>{children}</div>
        </div>
    );
}

function Chip({ color, children }: { color: 'accent' | 'muted'; children: ReactNode }) {
    return (
        <span className={`${s.chip} ${color === 'accent' ? s.chipAccent : s.chipMuted}`}>
            {children}
        </span>
    );
}

/* ─────────────── PairingRow ─────────────── */

function PairingRow({
    canvasCourse,
    decision,
    onChange,
    pairableLocal,
    usedLocalIds,
}: {
    canvasCourse: { canvasCourseId: string; fullTitle: string };
    decision: Decision;
    onChange: (next: Decision) => void;
    pairableLocal: Course[];
    usedLocalIds: Set<string>;
}) {
    const kind = decision.kind;

    return (
        <div className={`${s.row} ${kind !== 'defer' ? s.rowDecided : ''}`}>
            <div className={s.rowMain}>
                <div className={s.rowTitle}>{canvasCourse.fullTitle}</div>
                <div className={s.rowMeta}>course_{canvasCourse.canvasCourseId}</div>
            </div>
            <div className={s.rowAction}>
                <div className={s.actionTabs} role="tablist">
                    <ActionTab
                        active={kind === 'pair'}
                        onClick={() => {
                            const firstAvail = pairableLocal.find((c) => !usedLocalIds.has(c.id));
                            onChange({
                                kind: 'pair',
                                localCourseId:
                                    decision.kind === 'pair'
                                        ? decision.localCourseId
                                        : firstAvail?.id ?? '',
                            });
                        }}
                        disabled={pairableLocal.length === 0}
                        title={pairableLocal.length === 0 ? '沒有可對應的本機課（全部已配對）' : '對應到本機課'}
                    >
                        ⇄ 對應
                    </ActionTab>
                    <ActionTab
                        active={kind === 'create'}
                        onClick={() =>
                            onChange({
                                kind: 'create',
                                title:
                                    decision.kind === 'create'
                                        ? decision.title
                                        : canvasCourse.fullTitle,
                            })
                        }
                    >
                        ＋ 新建
                    </ActionTab>
                    <ActionTab
                        active={kind === 'ignore'}
                        onClick={() => onChange({ kind: 'ignore' })}
                    >
                        ⊘ 忽略
                    </ActionTab>
                    <ActionTab
                        active={kind === 'defer'}
                        onClick={() => onChange({ kind: 'defer' })}
                    >
                        ⏸ 稍後
                    </ActionTab>
                </div>

                {kind === 'pair' && (
                    <select
                        value={(decision as { localCourseId: string }).localCourseId}
                        onChange={(e) => onChange({ kind: 'pair', localCourseId: e.target.value })}
                        className={s.select}
                    >
                        <option value="" disabled>
                            選一門本機課…
                        </option>
                        {pairableLocal.map((c) => {
                            const usedElsewhere =
                                usedLocalIds.has(c.id) && c.id !== (decision as { localCourseId: string }).localCourseId;
                            return (
                                <option key={c.id} value={c.id} disabled={usedElsewhere}>
                                    {c.title}
                                    {usedElsewhere ? ' (已被其他列使用)' : ''}
                                </option>
                            );
                        })}
                    </select>
                )}

                {kind === 'create' && (
                    <input
                        type="text"
                        value={(decision as { title: string }).title}
                        onChange={(e) => onChange({ kind: 'create', title: e.target.value })}
                        className={s.input}
                        placeholder="本機顯示用名稱（可改縮寫）"
                        autoFocus
                    />
                )}

                {kind === 'ignore' && (
                    <span className={s.actionHint}>下次抓 Canvas 時不再跳出，rail 也不顯示。</span>
                )}

                {kind === 'defer' && (
                    <span className={s.actionHint}>之後在 rail 上會以「未配對」chip 顯示。</span>
                )}
            </div>
        </div>
    );
}

function ActionTab({
    active,
    onClick,
    disabled,
    title,
    children,
}: {
    active: boolean;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={`${s.actionTab} ${active ? s.actionTabActive : ''}`}
            role="tab"
            aria-selected={active}
        >
            {children}
        </button>
    );
}
