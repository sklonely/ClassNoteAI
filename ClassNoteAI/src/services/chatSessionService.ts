/**
 * 對話會話管理服務
 * 支持多對話、持久化、歷史壓縮機制
 */

import { ollamaService } from './ollamaService';

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
}

const STORAGE_KEY = 'chat_sessions';
const MAX_HISTORY_LENGTH = 10; // 超過此數量觸發壓縮

class ChatSessionService {
    /**
     * 獲取所有對話
     */
    public getAllSessions(): ChatSession[] {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) return [];
        try {
            return JSON.parse(data) as ChatSession[];
        } catch {
            return [];
        }
    }

    /**
     * 獲取指定課堂的對話列表
     * 優先返回當前課堂，其次全局對話
     */
    public getSessionsByLecture(lectureId?: string): ChatSession[] {
        const all = this.getAllSessions();

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
    public getSession(sessionId: string): ChatSession | null {
        const all = this.getAllSessions();
        return all.find(s => s.id === sessionId) || null;
    }

    /**
     * 創建新對話
     */
    public createSession(lectureId: string | null, title?: string): ChatSession {
        const session: ChatSession = {
            id: crypto.randomUUID(),
            lectureId,
            title: title || this.generateDefaultTitle(),
            messages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const all = this.getAllSessions();
        all.push(session);
        this.saveAll(all);

        console.log(`[ChatSessionService] 創建對話: ${session.id}`);
        return session;
    }

    /**
     * 更新對話標題
     */
    public updateTitle(sessionId: string, title: string): void {
        const all = this.getAllSessions();
        const session = all.find(s => s.id === sessionId);
        if (session) {
            session.title = title;
            session.updatedAt = new Date().toISOString();
            this.saveAll(all);
        }
    }

    /**
     * 添加消息到對話
     */
    public addMessage(sessionId: string, message: ChatMessage): void {
        const all = this.getAllSessions();
        const session = all.find(s => s.id === sessionId);
        if (!session) return;

        session.messages.push(message);
        session.updatedAt = new Date().toISOString();

        // 自動生成標題 (第一條用戶消息)
        if (session.messages.length === 1 && message.role === 'user') {
            session.title = message.content.slice(0, 30) + (message.content.length > 30 ? '...' : '');
        }

        this.saveAll(all);
    }

    /**
     * 刪除對話
     */
    public deleteSession(sessionId: string): void {
        const all = this.getAllSessions();
        const filtered = all.filter(s => s.id !== sessionId);
        this.saveAll(filtered);
        console.log(`[ChatSessionService] 刪除對話: ${sessionId}`);
    }

    /**
     * 獲取用於 LLM 的對話歷史
     * 10 條以內：直接返回
     * 超過 10 條：返回 [總結] + [最新 1 條]
     */
    public async getHistoryForLLM(sessionId: string): Promise<{ role: string; content: string }[]> {
        const session = this.getSession(sessionId);
        if (!session) return [];

        const messages = session.messages;

        if (messages.length <= MAX_HISTORY_LENGTH) {
            // 直接返回所有歷史
            return messages.map(m => ({
                role: m.role,
                content: m.content,
            }));
        }

        // 需要壓縮：生成摘要 + 最新消息
        const summary = session.summary || await this.generateSummary(session);

        // 保存摘要
        if (!session.summary) {
            this.updateSummary(sessionId, summary);
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
        const oldMessages = session.messages.slice(0, -1); // 排除最新一條
        const historyText = oldMessages
            .map(m => `${m.role === 'user' ? '用戶' : 'AI'}: ${m.content}`)
            .join('\n');

        const prompt = `請將以下對話歷史總結為簡潔的摘要（100字以內）：\n\n${historyText}`;

        try {
            const summary = await ollamaService.generate(prompt, {
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
    private updateSummary(sessionId: string, summary: string): void {
        const all = this.getAllSessions();
        const session = all.find(s => s.id === sessionId);
        if (session) {
            session.summary = summary;
            this.saveAll(all);
        }
    }

    /**
     * 生成默認標題
     */
    private generateDefaultTitle(): string {
        const now = new Date();
        return `對話 ${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    }

    /**
     * 保存所有對話
     */
    private saveAll(sessions: ChatSession[]): void {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    }

    /**
     * 清除指定課堂的所有對話
     */
    public clearByLecture(lectureId: string): void {
        const all = this.getAllSessions();
        const filtered = all.filter(s => s.lectureId !== lectureId);
        this.saveAll(filtered);
    }
}

export const chatSessionService = new ChatSessionService();
