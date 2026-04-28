/**
 * H18AIPage · v0.7.0 Phase 6.6 (full-screen AI 助教)
 *
 * 對應 docs/design/h18-deep/h18-nav-pages.jsx L604+ (AIPage).
 * 跟 H18AIDock 共用 useAIHistory（同一條對話 in localStorage）。
 *
 * 留白：
 *  - Multi-session list — 我們先用單一 default session，session 切換留 P6.x
 *  - Lecture-scoped citations — 同 dock，沒 RAG hover
 */

import { useEffect, useRef, useState } from 'react';
import { storageService } from '../../services/storageService';
import { useAIHistory, type AIMsg, type AIContext } from './useAIHistory';
import { keymapService } from '../../services/keymapService';
import { SHORTCUTS_CHANGE_EVENT } from '../../services/__contracts__/keymapService.contract';
import s from './H18AIPage.module.css';

export interface H18AIPageProps {
    onBack: () => void;
    /** Optional RAG grounding context — when provided, queries pull
     *  top-K chunks from the lecture/course index. */
    aiContext?: AIContext;
}

export default function H18AIPage({ onBack, aiContext }: H18AIPageProps) {
    const { msgs, streaming, send, clear } = useAIHistory();
    const [input, setInput] = useState('');
    const [lectureCount, setLectureCount] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        storageService
            .listLectures()
            .then((list) => {
                if (!cancelled) setLectureCount(list.length);
            })
            .catch(() => {
                /* swallow */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const t = setTimeout(() => inputRef.current?.focus(), 80);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        if (bodyRef.current) {
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
    }, [msgs]);

    // S3a-3: keep AI dock chip / clear-confirm copy in sync with the
    // user-customised toggleAiDock binding.
    const [, setShortcutsTick] = useState(0);
    useEffect(() => {
        const onChange = () => setShortcutsTick((n) => n + 1);
        window.addEventListener(SHORTCUTS_CHANGE_EVENT, onChange);
        return () =>
            window.removeEventListener(SHORTCUTS_CHANGE_EVENT, onChange);
    }, []);
    const aiDockLabel = keymapService.getDisplayLabel('toggleAiDock');

    const handleSend = () => {
        if (!input.trim() || streaming) return;
        const t = input;
        setInput('');
        void send(t, aiContext);
    };

    const userMsgCount = msgs.filter((m) => m.role === 'user' && !m.hint).length;
    const firstUserText =
        msgs.find((m) => m.role === 'user' && !m.hint)?.text || '新對話';

    return (
        <div className={s.page}>
            {/* Sidebar — sessions list (single default for now) */}
            <div className={s.sidebar}>
                <button type="button" onClick={onBack} className={s.backBtn}>
                    ← 返回
                </button>
                <div className={s.sectionHead}>最近對話</div>
                <button type="button" className={`${s.session} ${s.sessionActive}`}>
                    <div className={s.sessionTitle}>{firstUserText}</div>
                    <div className={s.sessionPreview}>
                        {streaming ? '回覆中…' : userMsgCount > 0 ? `${userMsgCount} 個提問` : '空'}
                    </div>
                    <div className={s.sessionMeta}>進行中</div>
                </button>
                <button
                    type="button"
                    onClick={async () => {
                        if (msgs.length > 1) {
                            const { confirmService } = await import(
                                '../../services/confirmService'
                            );
                            const ok = await confirmService.ask({
                                title: '清空目前對話？',
                                message:
                                    `AIPage 跟 ${aiDockLabel} 浮動 dock 共用同一條 history。\n清空後無法復原（多 session 還沒做）。`,
                                confirmLabel: '清空並開始新對話',
                                variant: 'danger',
                            });
                            if (!ok) return;
                        }
                        clear();
                        setInput('');
                    }}
                    className={s.newBtn}
                    title="開始新對話 (清空 history)"
                >
                    + 新對話
                </button>
            </div>

            {/* Main — full chat */}
            <div className={s.main}>
                <div className={s.head}>
                    <span className={s.headIcon} aria-hidden>✦</span>
                    <div>
                        <div className={s.headTitle}>AI 助教</div>
                        <div className={s.headSub}>
                            全域對話 · {userMsgCount} 個提問
                        </div>
                    </div>
                    <span className={s.headBadge}>覆蓋 {lectureCount} 份筆記</span>
                </div>

                <div className={s.body} ref={bodyRef}>
                    {msgs.length === 0 ? (
                        <div className={s.empty}>
                            <div className={s.emptyIcon}>✦</div>
                            還沒開始對話。
                            <br />
                            從下方輸入框開始，或在任何頁面按 {aiDockLabel} 開浮動 dock。
                        </div>
                    ) : (
                        msgs.map((m) => <Bubble key={m.id} m={m} />)
                    )}
                </div>

                <div className={s.foot}>
                    <div className={s.inputBox}>
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            placeholder="問 AI 任何問題…"
                            className={s.input}
                        />
                        <span className={s.inputKbd}>⌘↵</span>
                    </div>
                    <button
                        type="button"
                        onClick={handleSend}
                        disabled={!input.trim() || streaming}
                        className={s.sendBtn}
                    >
                        {streaming ? '…' : '送出'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Bubble({ m }: { m: AIMsg }) {
    if (m.hint) {
        return <div className={s.msgHint}>{m.text}</div>;
    }
    if (m.role === 'user') {
        return <div className={s.msgUser}>{m.text}</div>;
    }
    return (
        <div className={s.msgAI}>
            {m.streaming && !m.text && (
                <span className={s.thinking} aria-hidden>
                    <span className={s.thinkingDot} />
                    <span className={s.thinkingDot} />
                    <span className={s.thinkingDot} />
                </span>
            )}
            {m.text}
        </div>
    );
}
