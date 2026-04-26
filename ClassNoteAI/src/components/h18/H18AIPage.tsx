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
import { useAIHistory, type AIMsg } from './useAIHistory';
import s from './H18AIPage.module.css';

export interface H18AIPageProps {
    onBack: () => void;
}

export default function H18AIPage({ onBack }: H18AIPageProps) {
    const { msgs, streaming, send, clear } = useAIHistory();
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLInputElement | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const t = setTimeout(() => inputRef.current?.focus(), 80);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        if (bodyRef.current) {
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
    }, [msgs]);

    const handleSend = () => {
        if (!input.trim() || streaming) return;
        const t = input;
        setInput('');
        void send(t);
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
                    onClick={() => {
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
                    <span className={s.headBadge}>llm.chatStream</span>
                </div>

                <div className={s.body} ref={bodyRef}>
                    {msgs.length === 0 ? (
                        <div className={s.empty}>
                            <div className={s.emptyIcon}>✦</div>
                            還沒開始對話。
                            <br />
                            從下方輸入框開始，或在任何頁面按 ⌘J 開浮動 dock。
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
