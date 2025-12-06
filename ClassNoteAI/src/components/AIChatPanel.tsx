import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, Send, X, AlertCircle, Loader2, Minus, Maximize2 } from 'lucide-react';
import { ollamaService } from '../services/ollamaService';
import { storageService } from '../services/storageService';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

interface AIChatPanelProps {
    lectureId: string;
    isOpen: boolean;
    onClose: () => void;
    context?: {
        pdfText?: string;
        transcriptText?: string;
    };
    ollamaConnected: boolean;
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
}: AIChatPanelProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);

    // 視窗位置和大小
    const [position, setPosition] = useState({ x: window.innerWidth - DEFAULT_WIDTH - 20, y: 100 });
    const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
    const resizeRef = useRef({ isResizing: false, startX: 0, startY: 0, startWidth: 0, startHeight: 0 });

    // 載入對話歷史
    useEffect(() => {
        if (isOpen && lectureId) {
            loadChatHistory();
        }
    }, [isOpen, lectureId]);

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
            const history = await storageService.getChatHistory(lectureId);
            setMessages(history || []);
        } catch (error) {
            console.error('[AIChatPanel] 載入對話歷史失敗:', error);
        }
    };

    const saveChatHistory = async (newMessages: ChatMessage[]) => {
        try {
            await storageService.saveChatHistory(lectureId, newMessages);
        } catch (error) {
            console.error('[AIChatPanel] 儲存對話歷史失敗:', error);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || !ollamaConnected || isLoading) return;

        const userMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: input.trim(),
            timestamp: new Date().toISOString(),
        };

        const updatedMessages = [...messages, userMessage];
        setMessages(updatedMessages);
        setInput('');
        setIsLoading(true);

        try {
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

            const response = await ollamaService.generate(input.trim(), {
                system: systemPrompt,
            });

            const assistantMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: response,
                timestamp: new Date().toISOString(),
            };

            const finalMessages = [...updatedMessages, assistantMessage];
            setMessages(finalMessages);
            await saveChatHistory(finalMessages);
        } catch (error) {
            console.error('[AIChatPanel] 生成回答失敗:', error);
            const errorMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `抱歉，生成回答時發生錯誤：${error instanceof Error ? error.message : String(error)}`,
                timestamp: new Date().toISOString(),
            };
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
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
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

