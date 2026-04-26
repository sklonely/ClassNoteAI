/**
 * Shared AI conversation history for H18 AIDock + AIPage.
 *
 * 對應 docs/design/h18-deep/h18-aidock-recording.jsx loadAIHistory /
 * saveAIHistory，存 localStorage 讓 dock + page 共用同一條對話。
 *
 * Wire to llm.chatStream（不接 RAG —— 全域對話沒 lecture 上下文，
 * RAG-scoped chat 留在 legacy AIChatPanel，等 P6.x 收編）。
 */

import { useCallback, useEffect, useState } from 'react';
import { chatStream as llmChatStream } from '../../services/llm';
import type { LLMMessage } from '../../services/llm/types';

export interface AIMsg {
    role: 'user' | 'ai';
    text: string;
    /** Soft hint message (dashed border render) */
    hint?: boolean;
    /** Streaming-in-progress flag */
    streaming?: boolean;
    /** Citation pills (for future RAG integration; ignored for now) */
    cites?: { l: string }[];
    /** Local id for keys */
    id: string;
}

const STORE_KEY = 'h18-ai-history-v1';

const SYSTEM_PROMPT = `你是 ClassNoteAI 內建的全域 AI 助教，幫助使用者複習課程、整理筆記、寫作業。回答簡潔、直白、用繁體中文（除非使用者用其他語言）。`;

const DEFAULT_INTRO: AIMsg[] = [
    {
        id: 'intro',
        role: 'ai',
        text: '我已就位。要問什麼？可貼錯誤訊息、要重點整理、或要我推導某條公式。',
        hint: true,
    },
];

function loadHistory(): AIMsg[] {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch (err) {
        console.warn('[useAIHistory] load failed:', err);
    }
    return DEFAULT_INTRO;
}

function saveHistory(msgs: AIMsg[]): void {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(msgs));
    } catch (err) {
        console.warn('[useAIHistory] save failed:', err);
    }
}

export function useAIHistory() {
    const [msgs, setMsgs] = useState<AIMsg[]>(loadHistory);
    const [streaming, setStreaming] = useState(false);

    // Persist on every msgs change
    useEffect(() => {
        saveHistory(msgs);
    }, [msgs]);

    // Listen for external storage changes (dock + page on same window 不會
    // fire 'storage', 但若另一個 webview 寫了同 key 我們仍同步)
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === STORE_KEY && e.newValue) {
                try {
                    const parsed = JSON.parse(e.newValue);
                    if (Array.isArray(parsed)) setMsgs(parsed);
                } catch {
                    /* swallow */
                }
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const send = useCallback(
        async (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || streaming) return;

            const userMsg: AIMsg = {
                id: `u-${Date.now()}`,
                role: 'user',
                text: trimmed,
            };
            const aiMsgId = `a-${Date.now()}`;
            const aiMsg: AIMsg = {
                id: aiMsgId,
                role: 'ai',
                text: '',
                streaming: true,
            };
            // Build LLM messages (history without intro hint)
            const history = [...msgs, userMsg];
            const llmMsgs: LLMMessage[] = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...history
                    .filter((m) => !m.hint)
                    .map<LLMMessage>((m) => ({
                        role: m.role === 'user' ? 'user' : 'assistant',
                        content: m.text,
                    })),
            ];
            setMsgs([...msgs, userMsg, aiMsg]);
            setStreaming(true);

            let buffer = '';
            try {
                for await (const chunk of llmChatStream(llmMsgs)) {
                    buffer += chunk;
                    setMsgs((cur) => {
                        const next = [...cur];
                        const idx = next.findIndex((x) => x.id === aiMsgId);
                        if (idx >= 0) {
                            next[idx] = { ...next[idx], text: buffer, streaming: true };
                        }
                        return next;
                    });
                }
                setMsgs((cur) => {
                    const next = [...cur];
                    const idx = next.findIndex((x) => x.id === aiMsgId);
                    if (idx >= 0) next[idx] = { ...next[idx], streaming: false };
                    return next;
                });
            } catch (err) {
                console.error('[useAIHistory] chatStream failed:', err);
                setMsgs((cur) => {
                    const next = [...cur];
                    const idx = next.findIndex((x) => x.id === aiMsgId);
                    if (idx >= 0) {
                        next[idx] = {
                            ...next[idx],
                            text: `（錯誤：${(err as Error)?.message || '未知錯誤'}）`,
                            streaming: false,
                        };
                    }
                    return next;
                });
            } finally {
                setStreaming(false);
            }
        },
        [msgs, streaming],
    );

    const clear = useCallback(() => {
        setMsgs(DEFAULT_INTRO);
    }, []);

    return { msgs, streaming, send, clear };
}
