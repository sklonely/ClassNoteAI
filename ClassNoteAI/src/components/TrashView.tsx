import { useState, useEffect } from 'react';
import { Trash2, RotateCcw, AlertTriangle, BookOpen, FileText } from 'lucide-react';
import { storageService } from '../services/storageService';
import { Course, Lecture } from '../types';
import { message, ask } from '@tauri-apps/plugin-dialog';

interface TrashViewProps {
    onBack: () => void;
}

export default function TrashView({ onBack }: TrashViewProps) {
    const [deletedCourses, setDeletedCourses] = useState<Course[]>([]);
    const [deletedLectures, setDeletedLectures] = useState<Lecture[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'courses' | 'lectures'>('courses');

    const loadDeletedItems = async () => {
        setIsLoading(true);
        try {
            const [courses, lectures] = await Promise.all([
                storageService.listDeletedCourses(),
                storageService.listDeletedLectures()
            ]);
            setDeletedCourses(courses);
            setDeletedLectures(lectures);
        } catch (error) {
            console.error('Failed to load deleted items:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadDeletedItems();
    }, []);

    const handleRestore = async (type: 'course' | 'lecture', id: string) => {
        try {
            if (type === 'course') {
                await storageService.restoreCourse(id);
            } else {
                await storageService.restoreLecture(id);
            }
            await message('項目已還原成功！', { title: '還原成功', kind: 'info' });
            loadDeletedItems();
        } catch (error) {
            await message(`還原失敗: ${error}`, { title: '錯誤', kind: 'error' });
        }
    };

    const handlePurge = async (type: 'course' | 'lecture', id: string, title: string) => {
        const confirmed = await ask(`確定要永久刪除「${title}」嗎？\n\n此操作無法復原！`, {
            title: '永久刪除確認',
            kind: 'warning',
            okLabel: '永久刪除',
            cancelLabel: '取消'
        });

        if (!confirmed) return;

        try {
            if (type === 'course') {
                await storageService.purgeCourse(id);
            } else {
                await storageService.purgeLecture(id);
            }
            await message('項目已永久刪除！', { title: '刪除成功', kind: 'info' });
            loadDeletedItems();
        } catch (error) {
            await message(`刪除失敗: ${error}`, { title: '錯誤', kind: 'error' });
        }
    };

    const totalItems = deletedCourses.length + deletedLectures.length;

    return (
        <div className="h-full flex flex-col bg-gray-50 dark:bg-slate-900">
            {/* Header */}
            <div className="p-6 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
                    >
                        <RotateCcw size={20} />
                    </button>
                    <div className="flex items-center gap-2">
                        <Trash2 className="text-red-500" size={24} />
                        <h1 className="text-xl font-semibold">回收桶</h1>
                    </div>
                    <span className="text-sm text-gray-500">{totalItems} 個項目</span>
                </div>

                {/* Warning */}
                <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2">
                    <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                        已刪除的項目將在 30 天後自動永久刪除。您可以還原項目或立即永久刪除。
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mt-4">
                    <button
                        onClick={() => setActiveTab('courses')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'courses'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
                            }`}
                    >
                        <span className="flex items-center gap-2">
                            <BookOpen size={16} />
                            課程 ({deletedCourses.length})
                        </span>
                    </button>
                    <button
                        onClick={() => setActiveTab('lectures')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'lectures'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
                            }`}
                    >
                        <span className="flex items-center gap-2">
                            <FileText size={16} />
                            課堂 ({deletedLectures.length})
                        </span>
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full text-gray-500">
                        正在載入...
                    </div>
                ) : (
                    <>
                        {activeTab === 'courses' && (
                            <div className="space-y-3">
                                {deletedCourses.length === 0 ? (
                                    <div className="text-center py-12 text-gray-500">
                                        <Trash2 size={48} className="mx-auto opacity-30 mb-4" />
                                        <p>沒有已刪除的課程</p>
                                    </div>
                                ) : (
                                    deletedCourses.map(course => (
                                        <div key={course.id} className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                            <div>
                                                <h3 className="font-medium">{course.title}</h3>
                                                <p className="text-sm text-gray-500">{course.description || '無描述'}</p>
                                                <p className="text-xs text-gray-400 mt-1">
                                                    刪除於: {new Date(course.updated_at || '').toLocaleString()}
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleRestore('course', course.id)}
                                                    className="px-3 py-1.5 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg text-sm font-medium transition dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
                                                >
                                                    還原
                                                </button>
                                                <button
                                                    onClick={() => handlePurge('course', course.id, course.title)}
                                                    className="px-3 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-medium transition dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                                                >
                                                    永久刪除
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {activeTab === 'lectures' && (
                            <div className="space-y-3">
                                {deletedLectures.length === 0 ? (
                                    <div className="text-center py-12 text-gray-500">
                                        <Trash2 size={48} className="mx-auto opacity-30 mb-4" />
                                        <p>沒有已刪除的課堂</p>
                                    </div>
                                ) : (
                                    deletedLectures.map(lecture => (
                                        <div key={lecture.id} className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                            <div>
                                                <h3 className="font-medium">{lecture.title}</h3>
                                                <p className="text-sm text-gray-500">{lecture.date}</p>
                                                <p className="text-xs text-gray-400 mt-1">
                                                    刪除於: {new Date(lecture.updated_at || '').toLocaleString()}
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleRestore('lecture', lecture.id)}
                                                    className="px-3 py-1.5 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg text-sm font-medium transition dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
                                                >
                                                    還原
                                                </button>
                                                <button
                                                    onClick={() => handlePurge('lecture', lecture.id, lecture.title)}
                                                    className="px-3 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-medium transition dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                                                >
                                                    永久刪除
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
