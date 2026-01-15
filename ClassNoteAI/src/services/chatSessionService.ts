/**
 * 對話會話管理服務
 * 支持多對話、持久化、歷史壓縮機制
 * 使用 SQLite 存儲 (通過 Tauri invoke)
 */

import { invoke } from '@tauri-apps/api/core';
import { ollamaService } from './ollamaService';
import { authService } from './authService';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    sources?: Array<{ text: string; sourceType: string; pageNumber?: number; similarity: number }>;
}

export interface ChatSession {
    id: string;
    lectureId: string | null; // null = 全局對話
    title: string;
    messages: ChatMessage[];
    summary?: string; // 超過 10 條時的對話摘要
    createdAt: string;
    updatedAt: string;
    isDeleted?: boolean;
}

const STORAGE_KEY = 'chat_sessions'; // For migration
const MAX_HISTORY_LENGTH = 10; // 超過此數量觸發壓縮

class ChatSessionService {
    private userId: string = '';
    private migrationDone: boolean = false;

    /**
     * 初始化服務 (設置 userId)
     */
    public async init(): Promise<void> {
        const user = authService.getUser();
        this.userId = user?.username || 'default';
        await this.migrateFromLocalStorage();
    }

    /**
     * 從 localStorage 遷移到 SQLite (僅執行一次)
     */
    private async migrateFromLocalStorage(): Promise<void> {
        if (this.migrationDone) return;

        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (!data) {
                this.migrationDone = true;
                return;
            }

            const sessions: ChatSession[] = JSON.parse(data);
            if (sessions.length === 0) {
                this.migrationDone = true;
                return;
            }

            console.log(`[ChatSessionService] 遷移 ${sessions.length} 個對話從 localStorage 到 SQLite...`);

            for (const session of sessions) {
                // Save session
                await invoke('save_chat_session', {
                    id: session.id,
                    lectureId: session.lectureId,
                    userId: this.userId,
                    title: session.title,
                    summary: session.summary || null,
                    createdAt: session.createdAt,
                    updatedAt: session.updatedAt,
                    isDeleted: false,
                });

                // Save messages
                for (const msg of session.messages) {
                    await invoke('save_chat_message', {
                        id: msg.id,
                        sessionId: session.id,
                        role: msg.role,
                        content: msg.content,
                        sources: msg.sources ? JSON.stringify(msg.sources) : null,
                        timestamp: msg.timestamp,
                    });
                }
            }

            // 清除 localStorage
            localStorage.removeItem(STORAGE_KEY);
            console.log('[ChatSessionService] 遷移完成，已清除 localStorage');
            this.migrationDone = true;
        } catch (error) {
            console.error('[ChatSessionService] 遷移失敗:', error);
        }
    }

    /**
     * 獲取所有對話 (from SQLite)
     */
    public async getAllSessions(): Promise<ChatSession[]> {
        try {
            if (!this.userId) await this.init();

            const rawSessions = await invoke<any[]>('get_all_chat_sessions', { userId: this.userId });
            const rawMessages = await invoke<any[]>('get_all_chat_messages', { userId: this.userId });

            // Parse sessions
            const sessions: ChatSession[] = rawSessions.map((s: any) => ({
                id: s[0],
                lectureId: s[1],
                title: s[3],
                messages: [],
                summary: s[4],
                createdAt: s[5],
                updatedAt: s[6],
                isDeleted: s[7],
            }));

            // Parse messages and assign to sessions
            const messagesMap = new Map<string, ChatMessage[]>();
            for (const m of rawMessages) {
                const sessionId = m[1];
                if (!messagesMap.has(sessionId)) {
                    messagesMap.set(sessionId, []);
                }
                messagesMap.get(sessionId)!.push({
                    id: m[0],
                    role: m[2] as 'user' | 'assistant',
                    content: m[3],
                    sources: m[4] ? JSON.parse(m[4]) : undefined,
                    timestamp: m[5],
                });
            }

            for (const session of sessions) {
                session.messages = messagesMap.get(session.id) || [];
            }

            // Filter out deleted sessions
            return sessions.filter(s => !s.isDeleted);
        } catch (error) {
            console.error('[ChatSessionService] 獲取對話失敗:', error);
            return [];
        }
    }

    /**
     * 獲取指定課堂的對話列表
     */
    public async getSessionsByLecture(lectureId?: string): Promise<ChatSession[]> {
        const all = await this.getAllSessions();

        // 按更新時間降序
        const sorted = all.sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        if (!lectureId) return sorted;

        // 當前課堂 + 全局對話
        const currentLecture = sorted.filter(s => s.lectureId === lectureId);
        const global = sorted.filter(s => s.lectureId === null);
        const others = sorted.filter(s => s.lectureId !== lectureId && s.lectureId !== null);

        return [...currentLecture, ...global, ...others];
    }

    /**
     * 獲取單個對話
     */
    public async getSession(sessionId: string): Promise<ChatSession | null> {
        const all = await this.getAllSessions();
        return all.find(s => s.id === sessionId) || null;
    }

    /**
     * 創建新對話
     */
    public async createSession(lectureId: string | null, title?: string): Promise<ChatSession> {
        if (!this.userId) await this.init();

        const now = new Date().toISOString();
        const session: ChatSession = {
            id: crypto.randomUUID(),
            lectureId,
            title: title || this.generateDefaultTitle(),
            messages: [],
            createdAt: now,
            updatedAt: now,
        };

        await invoke('save_chat_session', {
            id: session.id,
            lectureId: session.lectureId,
            userId: this.userId,
            title: session.title,
            summary: null,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            isDeleted: false,
        });

        console.log(`[ChatSessionService] 創建對話: ${session.id}`);
        return session;
    }

    /**
     * 更新對話標題
     */
    public async updateTitle(sessionId: string, title: string): Promise<void> {
        const session = await this.getSession(sessionId);
        if (!session) return;

        const now = new Date().toISOString();
        await invoke('save_chat_session', {
            id: session.id,
            lectureId: session.lectureId,
            userId: this.userId,
            title: title,
            summary: session.summary || null,
            createdAt: session.createdAt,
            updatedAt: now,
            isDeleted: false,
        });
    }

    /**
     * 添加消息到對話
     */
    public async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
        if (!this.userId) await this.init();

        // Save message
        await invoke('save_chat_message', {
            id: message.id,
            sessionId: sessionId,
            role: message.role,
            content: message.content,
            sources: message.sources ? JSON.stringify(message.sources) : null,
            timestamp: message.timestamp,
        });

        // Update session's updatedAt and potentially title
        const session = await this.getSession(sessionId);
        if (session) {
            let title = session.title;
            // 自動生成標題 (第一條用戶消息)
            if (session.messages.length === 0 && message.role === 'user') {
                title = message.content.slice(0, 30) + (message.content.length > 30 ? '...' : '');
            }

            const now = new Date().toISOString();
            await invoke('save_chat_session', {
                id: session.id,
                lectureId: session.lectureId,
                userId: this.userId,
                title: title,
                summary: session.summary || null,
                createdAt: session.createdAt,
                updatedAt: now,
                isDeleted: false,
            });
        }
    }

    /**
     * 刪除對話 (軟刪除)
     */
    public async deleteSession(sessionId: string): Promise<void> {
        const session = await this.getSession(sessionId);
        if (!session) return;

        const now = new Date().toISOString();
        await invoke('save_chat_session', {
            id: session.id,
            lectureId: session.lectureId,
            userId: this.userId,
            title: session.title,
            summary: session.summary || null,
            createdAt: session.createdAt,
            updatedAt: now,
            isDeleted: true,
        });

        console.log(`[ChatSessionService] 刪除對話: ${sessionId}`);
    }

    /**
     * 獲取用於 LLM 的對話歷史
     */
    public async getHistoryForLLM(sessionId: string): Promise<{ role: string; content: string }[]> {
        const session = await this.getSession(sessionId);
        if (!session) return [];

        const messages = session.messages;

        if (messages.length <= MAX_HISTORY_LENGTH) {
            return messages.map(m => ({
                role: m.role,
                content: m.content,
            }));
        }

        // 需要壓縮：生成摘要 + 最新消息
        const summary = session.summary || await this.generateSummary(session);

        // 保存摘要
        if (!session.summary) {
            await this.updateSummary(sessionId, summary);
        }

        const latestMessage = messages[messages.length - 1];
        return [
            { role: 'system', content: `以下是之前對話的摘要：\n${summary}` },
            { role: latestMessage.role, content: latestMessage.content },
        ];
    }

    /**
     * 生成對話摘要
     */
    private async generateSummary(session: ChatSession): Promise<string> {
        const oldMessages = session.messages.slice(0, -1);
        const historyText = oldMessages
            .map(m => `${m.role === 'user' ? '用戶' : 'AI'}: ${m.content}`)
            .join('\n');

        const prompt = `請將以下對話歷史總結為簡潔的摘要（100字以內）：\n\n${historyText}`;

        try {
            const lightModel = await ollamaService.getLightModel();
            const summary = await ollamaService.generate(prompt, {
                model: lightModel,
                system: '你是一個對話摘要助手，請用繁體中文簡潔總結對話要點。',
            });
            console.log(`[ChatSessionService] 生成摘要: ${summary.slice(0, 50)}...`);
            return summary;
        } catch (error) {
            console.error('[ChatSessionService] 摘要生成失敗:', error);
            return '（摘要生成失敗）';
        }
    }

    /**
     * 更新對話摘要
     */
    private async updateSummary(sessionId: string, summary: string): Promise<void> {
        const session = await this.getSession(sessionId);
        if (!session) return;

        const now = new Date().toISOString();
        await invoke('save_chat_session', {
            id: session.id,
            lectureId: session.lectureId,
            userId: this.userId,
            title: session.title,
            summary: summary,
            createdAt: session.createdAt,
            updatedAt: now,
            isDeleted: false,
        });
    }

    /**
     * 生成默認標題
     */
    private generateDefaultTitle(): string {
        const now = new Date();
        return `對話 ${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    }

    /**
     * 清除指定課堂的所有對話 (軟刪除)
     */
    public async clearByLecture(lectureId: string): Promise<void> {
        const all = await this.getAllSessions();
        for (const session of all.filter(s => s.lectureId === lectureId)) {
            await this.deleteSession(session.id);
        }
    }
}

export const chatSessionService = new ChatSessionService();
