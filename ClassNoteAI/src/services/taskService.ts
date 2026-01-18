
import { storageService } from './storageService';
import { offlineQueueService } from './offlineQueueService';

export interface TaskResponse {
    id: string;
    task_type: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    priority: number;
    result?: any;
    error?: string;
    created_at: string;
    started_at?: string;
    completed_at?: string;
}

export interface TaskEvent {
    task_id: string;
    task_type: string;
    status: 'processing' | 'completed' | 'failed';
    result?: any;
    user_id?: string;
}

export interface PageData {
    page_number: number;
    text: string;
}

export interface PageEmbedding {
    id: number;
    lecture_id: string;
    page_number: number;
    content: string;
    embedding: number[];
    created_at: string;
}

class TaskService {
    constructor() {
        this.registerProcessors();
    }

    private registerProcessors(): void {
        // Register TASK_CREATE processor for offline queued tasks
        offlineQueueService.registerProcessor('TASK_CREATE', async (payload) => {
            await this.executeTaskDirect(payload);
        });
    }

    private async executeTaskDirect(payload: any): Promise<void> {
        // This executes a queued task request when coming back online
        const { endpoint, method, body } = payload;
        await this.request(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    private async getBaseUrl(): Promise<string> {
        const settings = await storageService.getAppSettings();
        return settings?.server?.url || 'http://localhost:3001';
    }

    private async request<T>(path: string, options?: RequestInit): Promise<T> {
        const baseUrl = await this.getBaseUrl();
        const url = `${baseUrl.replace(/\/$/, '')}${path}`;

        try {
            // Use Tauri plugin-http fetch to bypass macOS ATS restrictions
            const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
            const response = await tauriFetch(url, options as any);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Request failed: ${response.status} ${response.statusText} - ${errorText}`);
            }
            return await response.json() as T;
        } catch (error) {
            console.error(`[TaskService] Request failed for ${path}:`, error);
            throw error;
        }
    }

    /**
    * Trigger RAG Indexing for a lecture
    * If offline, queues for later execution
    */
    async triggerIndexing(lectureId: string, pages: PageData[]): Promise<TaskResponse | null> {
        if (!offlineQueueService.isOnline()) {
            await offlineQueueService.enqueue('TASK_CREATE', {
                endpoint: `/api/lectures/${lectureId}/index`,
                method: 'POST',
                body: pages,
            });
            console.log(`[TaskService] Queued indexing for lecture ${lectureId}`);
            return null;
        }
        return this.request<TaskResponse>(`/api/lectures/${lectureId}/index`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pages),
        });
    }

    /**
    * Get Page Embeddings
    */
    async getLectureEmbeddings(lectureId: string): Promise<PageEmbedding[]> {
        return this.request<PageEmbedding[]>(`/api/lectures/${lectureId}/embeddings`);
    }



    /**
    * Trigger Summary Generation
    * If offline, queues for later execution
    */
    async triggerSummary(lectureId: string, language: 'zh' | 'en', content: string, pdfContext?: string): Promise<TaskResponse | null> {
        const body = { language, content, pdf_context: pdfContext };
        if (!offlineQueueService.isOnline()) {
            await offlineQueueService.enqueue('TASK_CREATE', {
                endpoint: `/api/lectures/${lectureId}/summary`,
                method: 'POST',
                body,
            });
            console.log(`[TaskService] Queued summary for lecture ${lectureId}`);
            return null;
        }
        return this.request<TaskResponse>(`/api/lectures/${lectureId}/summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    async triggerKeywordExtract(courseId: string, text: string): Promise<TaskResponse | null> {
        const body = {
            task_type: 'keyword_extract',
            payload: { course_id: courseId, text },
            priority: 3
        };

        if (!offlineQueueService.isOnline()) {
            await offlineQueueService.enqueue('TASK_CREATE', {
                endpoint: '/api/tasks',
                method: 'POST',
                body,
            });
            console.log(`[TaskService] Queued keyword extract for course ${courseId}`);
            return null;
        }

        return this.request<TaskResponse>('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    async triggerChat(lectureId: string, messages: any[]): Promise<TaskResponse | null> {
        const body = {
            task_type: 'chat',
            payload: { lecture_id: lectureId, messages },
            priority: 1
        };

        if (!offlineQueueService.isOnline()) {
            // Chat might not be useful offline? But consistency matters.
            // Allow queueing
            await offlineQueueService.enqueue('TASK_CREATE', {
                endpoint: '/api/tasks',
                method: 'POST',
                body,
            });
            return null;
        }

        return this.request<TaskResponse>('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    /**
     * Proxy Embedding Request (Direct API, no queue if using proxy_embedding)
     */
    async generateEmbedding(text: string, model: string = 'nomic-embed-text'): Promise<number[]> {
        if (!offlineQueueService.isOnline()) {
            // Offline embedding not supported unless we have local model (unlikely for "Server-First")
            throw new Error("Cannot generate embeddings while offline (Server-First).");
        }
        return this.request<number[]>('/api/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, model }),
        });
    }

    /**
     * Trigger Syllabus Generation
     * If offline, queues for later execution
     */
    async triggerSyllabus(courseId: string, title: string, description?: string, targetLanguage?: string): Promise<TaskResponse | null> {
        // Updated to use generic /api/tasks endpoint if possible, or keep specialized if server supports it.
        // Server `worker.rs` added `syllabus` task type. Server `main.rs` `trigger_indexing` exists, but generic `/api/tasks` maps to `create_task`.
        // Let's use generic `/api/tasks` for syllabus too to support priority.
        const body = {
            task_type: 'syllabus',
            payload: {
                course_id: courseId,
                title,
                description,
                target_language: targetLanguage
            },
            priority: 5
        };

        if (!offlineQueueService.isOnline()) {
            await offlineQueueService.enqueue('TASK_CREATE', {
                endpoint: '/api/tasks',
                method: 'POST',
                body,
            });
            console.log(`[TaskService] Queued syllabus for course ${courseId}`);
            return null;
        }
        return this.request<TaskResponse>('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    /**
    * Poll Task Status
    */
    async getTaskStatus(taskId: string): Promise<TaskResponse> {
        return this.request<TaskResponse>(`/api/tasks/${taskId}`);
    }

    async getActiveTasks(): Promise<TaskResponse[]> {
        return this.request<TaskResponse[]>('/api/tasks/active');
    }

    /**
    * Helper to poll until completion
    */
    async pollUntilCompletion(taskId: string, intervalMs: number = 2000, timeoutMs: number = 300000): Promise<TaskResponse> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const task = await this.getTaskStatus(taskId);

            if (task.status === 'completed') {
                return task;
            }

            if (task.status === 'failed') {
                throw new Error(`Task failed: ${task.error}`);
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }

        throw new Error('Task polling timed out');
    }
    /**
     * Start SSE Stream
     */
    async startEventStream(onEvent: (event: TaskEvent) => void): Promise<EventSource> {
        const baseUrl = await this.getBaseUrl();
        const url = `${baseUrl.replace(/\/$/, '')}/api/events`;

        console.log('[TaskService] Connecting to SSE:', url);
        const eventSource = new EventSource(url);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data) as TaskEvent;
                console.log('[TaskService] SSE Received:', data);
                onEvent(data);
            } catch (err) {
                console.error('[TaskService] Failed to parse SSE event:', err);
            }
        };

        eventSource.onerror = (err) => {
            console.error('[TaskService] SSE Error:', err);
        };

        return eventSource;
    }
}

export const taskService = new TaskService();
