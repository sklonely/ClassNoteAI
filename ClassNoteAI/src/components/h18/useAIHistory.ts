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
import { ragService } from '../../services/ragService';

export interface AIContext {
    kind: 'lecture' | 'course' | 'global';
    /** Required for kind === 'lecture'; otherwise ignored. */
    lectureId?: string;
    /** Required for kind === 'course'; otherwise ignored. */
    courseId?: string;
    /** Display label, e.g. "ML · L13". */
    label?: string;
}

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

/* ─── Quota-safe localStorage wrapper (W14) ──────────────────────
 * Long AI conversations bloat history, so we're a likely first
 * trigger of QuotaExceededError. Wrap save and surface a throttled
 * warning toast; in-memory state still updates so the active chat
 * keeps working — the user just loses persistence across reloads.
 */
let __lastQuotaToastAt = 0;
const __TOAST_COOLDOWN_MS = 5_000;

function fireQuotaToast() {
    const now = Date.now();
    if (now - __lastQuotaToastAt < __TOAST_COOLDOWN_MS) return;
    __lastQuotaToastAt = now;
    void import('../../services/toastService').then(({ toastService }) => {
        toastService.warning(
            '本機儲存空間不足',
            '部分資料無法儲存。請至個人資料 → 資料 → 清除舊資料釋放空間。',
        );
    }).catch(() => {/* toast not available — best effort */});
}

function safeSetItem(k: string, value: string): boolean {
    try {
        localStorage.setItem(k, value);
        return true;
    } catch (err) {
        console.warn('[useAIHistory] localStorage write failed', err);
        fireQuotaToast();
        return false;
    }
}

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
    safeSetItem(STORE_KEY, JSON.stringify(msgs));
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
        async (text: string, ctx?: AIContext) => {
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

            // RAG: if the caller pinned a lecture/course context, retrieve
            // top-K chunks and prepend them to the system prompt as
            // grounding. Kept best-effort — if RAG fails (no index built,
            // embedding provider missing) we still send the question.
            let ragGrounding = '';
            const cites: { l: string }[] = [];
            try {
                if (ctx?.kind === 'lecture' && ctx.lectureId) {
                    const rc = await ragService.retrieveContext(
                        trimmed,
                        ctx.lectureId,
                        5,
                    );
                    if (rc.formattedContext) {
                        ragGrounding = rc.formattedContext;
                        for (const r of rc.chunks.slice(0, 3)) {
                            const id = (r as { chunk?: { id?: string }; chunkId?: string }).chunk?.id
                                ?? (r as { chunkId?: string }).chunkId
                                ?? '';
                            if (id) cites.push({ l: id.slice(0, 8) });
                        }
                    }
                } else if (ctx?.kind === 'course' && ctx.courseId) {
                    const rc = await ragService.retrieveCourseContext(
                        trimmed,
                        ctx.courseId,
                        5,
                    );
                    if (rc.formattedContext) ragGrounding = rc.formattedContext;
                }
            } catch (err) {
                console.warn('[useAIHistory] RAG retrieval failed (non-fatal):', err);
            }

            // Build LLM messages (history without intro hint)
            const history = [...msgs, userMsg];
            const systemContent = ragGrounding
                ? `${SYSTEM_PROMPT}\n\n以下是${ctx?.label ? `「${ctx.label}」` : '相關'}的課堂資料節錄，回答時請以這些為依據（沒寫到的就說沒有）：\n\n${ragGrounding}`
                : SYSTEM_PROMPT;
            const llmMsgs: LLMMessage[] = [
                { role: 'system', content: systemContent },
                ...history
                    .filter((m) => !m.hint)
                    .map<LLMMessage>((m) => ({
                        role: m.role === 'user' ? 'user' : 'assistant',
                        content: m.text,
                    })),
            ];
            if (cites.length > 0) aiMsg.cites = cites;
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
