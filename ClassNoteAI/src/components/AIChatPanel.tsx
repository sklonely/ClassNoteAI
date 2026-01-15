import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, Send, X, AlertCircle, Loader2, Minus, Maximize2, Database, Zap, Plus, History, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ollamaService } from '../services/ollamaService';
import { ragService, IndexingProgress } from '../services/ragService';
import { chatSessionService, ChatSession, ChatMessage } from '../services/chatSessionService';

// 重新導出 ChatMessage 類型供其他組件使用
export type { ChatMessage } from '../services/chatSessionService';

interface AIChatPanelProps {
    lectureId: string;
    isOpen: boolean;
    onClose: () => void;
    context?: {
        pdfText?: string;
        transcriptText?: string;
        pdfData?: ArrayBuffer;
    };
    ollamaConnected: boolean;
    currentPage?: number;
    onNavigateToPage?: (page: number) => void; // 回調跳轉到指定頁面
}

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 480;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 300;

export default function AIChatPanel({
    lectureId,
    isOpen,
    onClose,
    context,
    ollamaConnected,
    currentPage,
    onNavigateToPage,
}: AIChatPanelProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [useRAG, setUseRAG] = useState(true);
    const [isIndexing, setIsIndexing] = useState(false);
    const [indexingProgress, setIndexingProgress] = useState<IndexingProgress | null>(null);
    const [hasIndex, setHasIndex] = useState(false);

    // 對話管理狀態
    const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [showSessions, setShowSessions] = useState(false);

    // 視窗位置和大小
    const [position, setPosition] = useState({ x: window.innerWidth - DEFAULT_WIDTH - 20, y: 100 });
    const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
    const resizeRef = useRef({ isResizing: false, startX: 0, startY: 0, startWidth: 0, startHeight: 0 });

    // 載入對話歷史和檢查索引狀態
    useEffect(() => {
        if (isOpen && lectureId) {
            loadChatHistory();
            checkIndexStatus();
        }
    }, [isOpen, lectureId]);

    // 檢查是否有 RAG 索引，沒有則自動建立
    const checkIndexStatus = async () => {
        try {
            const indexed = await ragService.hasIndex(lectureId);
            setHasIndex(indexed);

            // 如果沒有索引且有內容可索引，自動建立
            if (!indexed && (context?.pdfText || context?.transcriptText)) {
                console.log('[AIChatPanel] 未檢測到索引，自動開始建立...');
                await buildIndex();
            }
        } catch (error) {
            console.error('[AIChatPanel] 檢查索引狀態失敗:', error);
        }
    };

    // 建立 RAG 索引 (統一使用 OCR 模式)
    const buildIndex = async (forceRefresh: boolean = false) => {
        if (isIndexing) return;

        setIsIndexing(true);
        try {
            if (context?.pdfData) {
                // 使用 DeepSeek-OCR 模式識別 PDF
                console.log(`[AIChatPanel] 使用 OCR 模式建立索引 (強制刷新: ${forceRefresh})`);
                await ragService.indexLectureWithOCR(
                    lectureId,
                    context.pdfData,
                    context?.transcriptText || null,
                    (progress) => setIndexingProgress(progress),
                    forceRefresh
                );
            } else if (context?.pdfText || context?.transcriptText) {
                // 無 PDF 時使用文本模式 (僅錄音轉錄)
                console.log('[AIChatPanel] 使用文本模式建立索引 (無 PDF)');
                await ragService.indexLecture(
                    lectureId,
                    context?.pdfText || null,
                    context?.transcriptText || null,
                    (progress) => setIndexingProgress(progress)
                );
            }
            setHasIndex(true);
            setIndexingProgress(null);
        } catch (error) {
            console.error('[AIChatPanel] 建立索引失敗:', error);
        } finally {
            setIsIndexing(false);
        }
    };

    // 自動滾動到底部
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // 拖曳處理
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.drag-handle')) {
            dragRef.current = {
                isDragging: true,
                startX: e.clientX,
                startY: e.clientY,
                startPosX: position.x,
                startPosY: position.y,
            };
            e.preventDefault();
        }
    }, [position]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (dragRef.current.isDragging) {
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            setPosition({
                x: Math.max(0, Math.min(window.innerWidth - size.width, dragRef.current.startPosX + dx)),
                y: Math.max(0, Math.min(window.innerHeight - 100, dragRef.current.startPosY + dy)),
            });
        }
        if (resizeRef.current.isResizing) {
            const dx = e.clientX - resizeRef.current.startX;
            const dy = e.clientY - resizeRef.current.startY;
            setSize({
                width: Math.max(MIN_WIDTH, resizeRef.current.startWidth + dx),
                height: Math.max(MIN_HEIGHT, resizeRef.current.startHeight + dy),
            });
        }
    }, [size.width]);

    const handleMouseUp = useCallback(() => {
        dragRef.current.isDragging = false;
        resizeRef.current.isResizing = false;
    }, []);

    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

    // 縮放處理
    const handleResizeStart = (e: React.MouseEvent) => {
        resizeRef.current = {
            isResizing: true,
            startX: e.clientX,
            startY: e.clientY,
            startWidth: size.width,
            startHeight: size.height,
        };
        e.preventDefault();
        e.stopPropagation();
    };

    const loadChatHistory = async () => {
        try {
            const allSessions = await chatSessionService.getSessionsByLecture(lectureId);
            setSessions(allSessions);

            const lectureSession = allSessions.find(s => s.lectureId === lectureId);
            if (lectureSession) {
                setCurrentSession(lectureSession);
                setMessages(lectureSession.messages);
            } else {
                setCurrentSession(null);
                setMessages([]);
            }
        } catch (error) {
            console.error('[AIChatPanel] 載入對話歷史失敗:', error);
        }
    };

    const createNewSession = async () => {
        const session = await chatSessionService.createSession(lectureId);
        setCurrentSession(session);
        setMessages([]);
        setSessions(prev => [session, ...prev]);
        setShowSessions(false);
    };

    const switchSession = (session: ChatSession) => {
        setCurrentSession(session);
        setMessages(session.messages);
        setShowSessions(false);
    };

    const deleteSession = async (sessionId: string) => {
        await chatSessionService.deleteSession(sessionId);
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        if (currentSession?.id === sessionId) {
            setCurrentSession(null);
            setMessages([]);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || !ollamaConnected || isLoading) return;

        // 自動創建 session (如果沒有)
        let session = currentSession;
        if (!session) {
            session = await chatSessionService.createSession(lectureId);
            setCurrentSession(session);
            setSessions(prev => [session!, ...prev]);
        }

        const userMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: input.trim(),
            timestamp: new Date().toISOString(),
        };

        // 保存用戶消息
        await chatSessionService.addMessage(session.id, userMessage);

        const updatedMessages = [...messages, userMessage];
        setMessages(updatedMessages);
        setInput('');
        setIsLoading(true);

        try {
            let assistantMessage: ChatMessage;

            // 獲取壓縮後的對話歷史
            const chatHistory = await chatSessionService.getHistoryForLLM(session.id);

            if (useRAG && hasIndex) {
                // 使用 RAG 增強問答 (傳入對話歷史)
                console.log(`[AIChatPanel] 使用 RAG 模式 (當前頁:${currentPage || 'N/A'}, 歷史:${chatHistory.length}條)`);
                const standardModel = await ollamaService.getStandardModel();
                const { answer, sources } = await ragService.chat(input.trim(), lectureId, {
                    topK: 5,
                    systemPrompt: '你是一個專業的課程助教，幫助學生理解課程內容。請用繁體中文回答。',
                    currentPage,
                    chatHistory: chatHistory.filter(m => m.role !== 'system') as Array<{ role: 'user' | 'assistant'; content: string }>,
                    model: standardModel,
                });

                assistantMessage = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: answer,
                    timestamp: new Date().toISOString(),
                    sources: sources.map(s => ({
                        text: s.chunk.chunkText.slice(0, 100) + '...',
                        sourceType: s.chunk.sourceType,
                        pageNumber: s.chunk.pageNumber,
                        similarity: s.similarity,
                    })),
                };
            } else {
                // 傳統模式：直接傳入全文
                console.log('[AIChatPanel] 使用傳統模式');
                let systemPrompt = '你是一個專業的課程助教，幫助學生理解課程內容。請用繁體中文回答。';

                if (context?.pdfText || context?.transcriptText) {
                    systemPrompt += '\n\n以下是課程相關內容供參考：\n';
                    if (context.pdfText) {
                        systemPrompt += `\n【課程講義】\n${context.pdfText.slice(0, 3000)}`;
                    }
                    if (context.transcriptText) {
                        systemPrompt += `\n\n【課堂錄音轉錄】\n${context.transcriptText.slice(0, 3000)}`;
                    }
                }

                // 使用對話式 API (標準模型)
                const standardModel = await ollamaService.getStandardModel();
                const response = await ollamaService.chat(
                    chatHistory as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
                    { system: systemPrompt, model: standardModel }
                );

                assistantMessage = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: response,
                    timestamp: new Date().toISOString(),
                };
            }

            // 保存助手消息
            await chatSessionService.addMessage(session.id, assistantMessage);

            const finalMessages = [...updatedMessages, assistantMessage];
            setMessages(finalMessages);
        } catch (error) {
            console.error('[AIChatPanel] 生成回答失敗:', error);
            const errorMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `抱歉，生成回答時發生錯誤：${error instanceof Error ? error.message : String(error)}`,
                timestamp: new Date().toISOString(),
            };
            await chatSessionService.addMessage(session.id, errorMessage);
            setMessages([...updatedMessages, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            ref={panelRef}
            className="fixed flex flex-col bg-white dark:bg-slate-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-600 z-50 overflow-hidden"
            style={{
                left: position.x,
                top: position.y,
                width: isMinimized ? 200 : size.width,
                height: isMinimized ? 48 : size.height,
            }}
            onMouseDown={handleMouseDown}
        >
            {/* Header - 可拖曳 */}
            <div className="drag-handle flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-purple-500 to-blue-500 cursor-move select-none">
                <div className="flex items-center gap-2 text-white">
                    <Bot className="w-4 h-4" />
                    <span className="font-medium text-sm">AI 助教</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={createNewSession}
                        className="p-1 hover:bg-white/20 rounded transition-colors text-white"
                        title="新對話"
                    >
                        <Plus className="w-3 h-3" />
                    </button>
                    <button
                        onClick={() => setShowSessions(!showSessions)}
                        className={`p-1 hover:bg-white/20 rounded transition-colors text-white ${showSessions ? 'bg-white/20' : ''}`}
                        title="對話歷史"
                    >
                        <History className="w-3 h-3" />
                    </button>
                    <button
                        onClick={() => setIsMinimized(!isMinimized)}
                        className="p-1 hover:bg-white/20 rounded transition-colors text-white"
                        title={isMinimized ? '展開' : '最小化'}
                    >
                        {isMinimized ? <Maximize2 className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-white/20 rounded transition-colors text-white"
                        title="關閉"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            </div>

            {/* 對話歷史列表 */}
            {showSessions && !isMinimized && (
                <div className="absolute top-12 left-0 right-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700 shadow-lg z-10 max-h-48 overflow-y-auto">
                    {sessions.length === 0 ? (
                        <div className="p-3 text-center text-gray-500 text-xs">尚無對話歷史</div>
                    ) : (
                        sessions.map(session => (
                            <div
                                key={session.id}
                                className={`flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-slate-700/50 cursor-pointer text-sm ${currentSession?.id === session.id ? 'bg-purple-50 dark:bg-purple-900/20' : ''
                                    }`}
                                onClick={() => switchSession(session)}
                            >
                                <div className="truncate flex-1">
                                    <div className="font-medium truncate">{session.title}</div>
                                    <div className="text-xs text-gray-500">
                                        {session.messages.length} 則訊息 · {new Date(session.updatedAt).toLocaleDateString()}
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded text-gray-400 hover:text-red-500"
                                    title="刪除"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            )}
            {!isMinimized && (
                <>
                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                        {!ollamaConnected && (
                            <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-lg text-xs">
                                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                                <span>Ollama 未連線</span>
                            </div>
                        )}

                        {/* RAG 索引狀態 */}
                        {ollamaConnected && (
                            <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-slate-700/50 rounded-lg text-xs">
                                <div className="flex items-center gap-2">
                                    <Database className="w-3 h-3 text-gray-500" />
                                    {hasIndex ? (
                                        <button
                                            onClick={() => setUseRAG(!useRAG)}
                                            className={`flex items-center gap-1 ${useRAG ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}
                                            title={useRAG ? '點擊切換到傳統模式' : '點擊切換到 RAG 模式'}
                                        >
                                            <Zap className="w-3 h-3" />
                                            {useRAG ? 'RAG 啟用' : 'RAG 關閉'}
                                        </button>
                                    ) : (
                                        <span className="text-gray-500">尚未建立索引</span>
                                    )}
                                </div>
                                {!isIndexing && (context?.pdfText || context?.transcriptText || context?.pdfData) && (
                                    <button
                                        onClick={() => buildIndex(true)}
                                        className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                                    >
                                        {hasIndex ? '重建索引' : '建立索引'}
                                    </button>
                                )}
                                {isIndexing && indexingProgress && (
                                    <span className="text-blue-500 flex items-center gap-1">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        {indexingProgress.message}
                                    </span>
                                )}
                            </div>
                        )}

                        {messages.length === 0 && ollamaConnected && (
                            <div className="text-center text-gray-400 dark:text-gray-500 py-6">
                                <Bot className="w-10 h-10 mx-auto mb-2 opacity-50" />
                                <p className="text-sm">有問題嗎？問問 AI 助教吧！</p>
                            </div>
                        )}

                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${msg.role === 'user'
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-gray-200'
                                        }`}
                                >
                                    {msg.role === 'user' ? (
                                        <p className="whitespace-pre-wrap">{msg.content}</p>
                                    ) : (
                                        <>
                                            <div className="prose prose-sm dark:prose-invert max-w-none">
                                                <ReactMarkdown
                                                    components={{
                                                        a: ({ node, href, children, ...props }) => {
                                                            if (href && href.startsWith('#page-')) {
                                                                const pageNum = parseInt(href.replace('#page-', ''));
                                                                return (
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.preventDefault();
                                                                            onNavigateToPage?.(pageNum);
                                                                        }}
                                                                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded transition-colors align-middle"
                                                                        title={`跳轉到第 ${pageNum} 頁`}
                                                                    >
                                                                        <span className="w-1 h-1 rounded-full bg-blue-600 dark:bg-blue-400"></span>
                                                                        {children}
                                                                    </button>
                                                                );
                                                            }
                                                            return <a href={href} {...props} target="_blank" rel="noopener noreferrer">{children}</a>;
                                                        }
                                                    }}
                                                >
                                                    {msg.content.replace(/\[\[頁碼:(\d+)\]\]/g, '[第 $1 頁](#page-$1)')}
                                                </ReactMarkdown>
                                            </div>
                                            {/* 來源引用連結 */}
                                            {msg.sources && msg.sources.length > 0 && (
                                                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                                                    <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-1">
                                                        <span>來源:</span>
                                                        {msg.sources.map((source, idx) => (
                                                            source.pageNumber ? (
                                                                <button
                                                                    key={idx}
                                                                    onClick={() => onNavigateToPage?.(source.pageNumber!)}
                                                                    className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                                                                    title={`跳轉到第 ${source.pageNumber} 頁`}
                                                                >
                                                                    第{source.pageNumber}頁
                                                                </button>
                                                            ) : (
                                                                <span key={idx} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                                                                    {source.sourceType === 'transcript' ? '錄音' : '講義'}
                                                                </span>
                                                            )
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}

                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-gray-100 dark:bg-slate-700 px-3 py-2 rounded-lg">
                                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="p-2 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder={ollamaConnected ? '輸入問題...' : 'Ollama 未連線'}
                                disabled={!ollamaConnected || isLoading}
                                className="flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-slate-700 border-0 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                            />
                            <button
                                onClick={handleSend}
                                disabled={!ollamaConnected || !input.trim() || isLoading}
                                className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Resize Handle */}
                    <div
                        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
                        onMouseDown={handleResizeStart}
                    >
                        <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M22 22H20V20H22V22ZM22 18H18V22H22V18ZM18 22H14V18H18V22Z" />
                        </svg>
                    </div>
                </>
            )}
        </div>
    );
}

