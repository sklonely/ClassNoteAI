import React, { useState, useEffect } from 'react';
import {
    Plus,
    MoreVertical,
    GraduationCap,
    Trash2,
    Calendar,
    BookOpen,
    Edit2,
    User,
    Clock,
    MapPin
} from 'lucide-react';
import { Course } from '../types';
import { storageService } from '../services/storageService';
import { ollamaService } from '../services/ollamaService';
import CourseCreationDialog from './CourseCreationDialog';

interface CourseListViewProps {
    onSelectCourse: (courseId: string) => void;
}

const CourseListView: React.FC<CourseListViewProps> = ({ onSelectCourse }) => {
    const [courses, setCourses] = useState<Course[]>([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [editingCourse, setEditingCourse] = useState<Course | null>(null);

    useEffect(() => {
        loadCourses();
    }, []);

    // 點擊外部關閉菜單（但不在刪除確認期間）
    useEffect(() => {
        const handleClickOutside = () => {
            if (!isDeleting) {
                setMenuOpenId(null);
            }
        };
        if (menuOpenId) {
            document.addEventListener('click', handleClickOutside);
        }
        return () => {
            document.removeEventListener('click', handleClickOutside);
        };
    }, [menuOpenId, isDeleting]);

    const loadCourses = async () => {
        try {
            const list = await storageService.listCourses();
            setCourses(list);
        } catch (error) {
            console.error('Failed to load courses:', error);
        }
    };

    const handleCreateCourse = async (title: string, keywords: string, _pdfData?: ArrayBuffer, description?: string) => {
        if (!title.trim()) return;

        try {
            let syllabusInfo = undefined;

            // Only extract if description changed and is long enough
            const descriptionChanged = !editingCourse || description !== editingCourse.description;

            if (descriptionChanged && description && description.trim().length > 50) {
                // 如果有足夠長的描述，嘗試提取結構化信息
                console.log('[CourseListView] Extracting syllabus info...');
                const extracted = await ollamaService.extractSyllabusInfo(description);
                console.log('[CourseListView] Extracted syllabus info:', extracted);

                // Only use if extraction was successful (has keys)
                if (extracted && Object.keys(extracted).length > 0) {
                    syllabusInfo = extracted;
                }
            }

            if (editingCourse) {
                // Update existing course
                const updatedCourse: Course = {
                    ...editingCourse,
                    title: title,
                    description: description || '',
                    keywords: keywords,
                    // Use new syllabus info if available, otherwise keep old one
                    // BUT if description changed and extraction failed (syllabusInfo is undefined), 
                    // we might want to keep the old one? Or clear it?
                    // If description changed significantly, old syllabus might be invalid.
                    // But for safety, let's keep old one unless we have a new one.
                    syllabus_info: syllabusInfo || editingCourse.syllabus_info,
                    updated_at: new Date().toISOString()
                };
                await storageService.saveCourse(updatedCourse);
            } else {
                // Create new course
                const newCourse: Course = {
                    id: crypto.randomUUID(),
                    title: title,
                    description: description || '',
                    keywords: keywords,
                    syllabus_info: syllabusInfo,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                await storageService.saveCourse(newCourse);
            }

            setIsDialogOpen(false);
            setEditingCourse(null);
            loadCourses();
        } catch (error) {
            console.error('Failed to save course:', error);
        }
    };

    const handleEditCourse = (course: Course, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingCourse(course);
        setMenuOpenId(null);
        setIsDialogOpen(true);
    };

    const handleDeleteCourse = async (courseId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        console.log('[CourseListView] Delete button clicked for course:', courseId);
        console.log('[CourseListView] Current courses count:', courses.length);

        setIsDeleting(true);

        try {
            // Use Tauri's native dialog instead of window.confirm
            const { confirm } = await import('@tauri-apps/plugin-dialog');
            const confirmed = await confirm(
                '所有相關的課堂和錄音都將被刪除。',
                {
                    title: '確定要刪除此科目嗎？',
                    kind: 'warning',
                    okLabel: '刪除',
                    cancelLabel: '取消'
                }
            );

            setIsDeleting(false);
            console.log('[CourseListView] User confirmed:', confirmed);

            if (confirmed) {
                console.log('[CourseListView] Deleting course...');
                await storageService.deleteCourse(courseId);
                console.log('[CourseListView] Course deleted, reloading list...');
                await loadCourses();
                setMenuOpenId(null);
                console.log('[CourseListView] Courses reloaded, new count:', courses.length);
            } else {
                console.log('[CourseListView] User cancelled deletion');
                setMenuOpenId(null);
            }
        } catch (error) {
            setIsDeleting(false);
            console.error('[CourseListView] Error during deletion:', error);
            alert('刪除失敗，請重試');
        }
    };

    return (
        <div className="p-6 h-full overflow-auto bg-gray-50 dark:bg-gray-900">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                    <GraduationCap className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                    我的科目
                </h1>
                <button
                    onClick={() => setIsDialogOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                >
                    <Plus className="w-5 h-5" />
                    新增科目
                </button>
            </div>

            {courses.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[60vh] text-gray-400 dark:text-gray-500">
                    <GraduationCap className="w-24 h-24 mb-4 opacity-20" />
                    <p className="text-xl font-medium">還沒有科目</p>
                    <p className="mt-2 text-sm">點擊右上角按鈕開始創建您的第一個科目</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {courses.map((course) => (
                        <div
                            key={course.id}
                            onClick={() => onSelectCourse(course.id)}
                            className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md hover:-translate-y-1 transition-all cursor-pointer group relative flex flex-col h-full"
                        >
                            <div className="flex justify-between items-start mb-3">
                                <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 line-clamp-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                    {course.title}
                                </h2>
                                <div className="relative">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setMenuOpenId(menuOpenId === course.id ? null : course.id);
                                        }}
                                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                    >
                                        <MoreVertical className="w-5 h-5" />
                                    </button>

                                    {menuOpenId === course.id && (
                                        <div className="absolute right-0 top-8 w-32 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-100 dark:border-gray-700 z-10 py-1">
                                            <button
                                                onClick={(e) => handleEditCourse(course, e)}
                                                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                                編輯
                                            </button>
                                            <button
                                                onClick={(e) => handleDeleteCourse(course.id, e)}
                                                className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                刪除
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Course Content / Description */}
                            <div className="flex-grow mb-4">
                                {course.syllabus_info?.topic ? (
                                    <div className="space-y-2">
                                        <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3 font-medium">
                                            {course.syllabus_info.topic}
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-gray-500 dark:text-gray-400 text-sm line-clamp-3">
                                        {course.description || (course.keywords ? `關鍵詞: ${course.keywords}` : '無描述')}
                                    </p>
                                )}
                            </div>

                            {/* Footer Info */}
                            <div className="pt-3 border-t border-gray-50 dark:border-gray-700 space-y-2">
                                {course.syllabus_info ? (
                                    <>
                                        {course.syllabus_info.instructor && (
                                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                                <User className="w-3.5 h-3.5 text-blue-500" />
                                                <span className="line-clamp-1">{course.syllabus_info.instructor}</span>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                                            {course.syllabus_info.time && (
                                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                                    <Clock className="w-3.5 h-3.5 text-green-500" />
                                                    <span className="line-clamp-1 max-w-[100px]">{course.syllabus_info.time}</span>
                                                </div>
                                            )}
                                            {course.syllabus_info.location && (
                                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                                    <MapPin className="w-3.5 h-3.5 text-red-500" />
                                                    <span className="line-clamp-1 max-w-[80px]">{course.syllabus_info.location}</span>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                                        <div className="flex items-center gap-1">
                                            <Calendar className="w-3.5 h-3.5" />
                                            {new Date(course.updated_at).toLocaleDateString()}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <BookOpen className="w-3.5 h-3.5" />
                                            進入學習
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <CourseCreationDialog
                isOpen={isDialogOpen}
                onClose={() => {
                    setIsDialogOpen(false);
                    setEditingCourse(null);
                }}
                onSubmit={handleCreateCourse}
                initialTitle={editingCourse?.title}
                initialKeywords={editingCourse?.keywords}
                initialDescription={editingCourse?.description}
                mode={editingCourse ? 'edit' : 'create'}
            />
        </div>
    );
};

export default CourseListView;
