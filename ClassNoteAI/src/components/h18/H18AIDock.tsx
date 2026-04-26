/**
 * H18AIDock · v0.7.0 Phase 6.6
 *
 * 對應 docs/design/h18-deep/h18-aidock-recording.jsx (AIDock).
 * ⌘J 浮動小窗，bottom-center，shared history 跟 H18AIPage。
 */

import { useEffect, useRef, useState } from 'react';
import { useAIHistory, type AIMsg } from './useAIHistory';
import s from './H18AIDock.module.css';

const QUICK_QUESTIONS = [
    '幫我整理今天的重點',
    '哪些是常考的？',
    '解釋這個公式',
    '幫我擬一份大綱',
];

export interface H18AIDockProps {
    open: boolean;
    onClose: () => void;
    onExpand: () => void;
    /** Display-only context label, e.g. "ML · L13" */
    contextHint?: string;
}

export default function H18AIDock({
    open,
    onClose,
    onExpand,
    contextHint,
}: H18AIDockProps) {
    const { msgs, streaming, send } = useAIHistory();
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLInputElement | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (open && inputRef.current) {
            const t = setTimeout(() => inputRef.current?.focus(), 50);
            return () => clearTimeout(t);
        }
    }, [open]);

    // auto-scroll on new msgs
    useEffect(() => {
        if (bodyRef.current) {
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
    }, [msgs]);

    if (!open) return null;

    const handleSend = () => {
        if (!input.trim() || streaming) return;
        const t = input;
        setInput('');
        void send(t);
    };

    return (
        <div className={s.scrim} onClick={onClose}>
            <div
                className={s.dock}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="AI 助教"
            >
                <div className={s.head}>
                    <span className={s.headIcon} aria-hidden>✦</span>
                    <span className={s.headTitle}>AI 助教</span>
                    {contextHint && (
                        <span className={s.contextPill}>{contextHint}</span>
                    )}
                    <div style={{ flex: 1 }} />
                    <button
                        type="button"
                        onClick={onExpand}
                        className={s.expandBtn}
                        title="在 AI 助教頁繼續 (全螢幕)"
                    >
                        <span style={{ fontSize: 11 }}>⛶</span>
                        全螢幕
                    </button>
                    <span className={s.kbdHint}>ESC 關閉</span>
                    <button
                        type="button"
                        onClick={onClose}
                        className={s.closeBtn}
                        aria-label="關閉"
                    >
                        ✕
                    </button>
                </div>

                <div className={s.body} ref={bodyRef}>
                    {msgs.map((m) => (
                        <Bubble key={m.id} m={m} />
                    ))}
                    {msgs.length <= 1 && (
                        <div className={s.quickQs}>
                            {QUICK_QUESTIONS.map((q) => (
                                <button
                                    key={q}
                                    type="button"
                                    onClick={() => setInput(q)}
                                    className={s.quickQ}
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className={s.foot}>
                    <div className={s.inputBox}>
                        <span className={s.inputIcon} aria-hidden>?</span>
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
                            placeholder="問任何問題，或貼上關鍵字…"
                            className={s.input}
                        />
                        <span className={s.inputKbd}>↵</span>
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
            {m.cites && m.cites.length > 0 && (
                <div className={s.cites}>
                    {m.cites.map((c, j) => (
                        <span key={j} className={s.cite}>
                            → {c.l}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
