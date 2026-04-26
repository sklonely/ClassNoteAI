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
import s from './CourseListView.module.css';
import CourseCreationDialog from './CourseCreationDialog';

/** Same defensive normalization as CourseDetailView — LLM JSON sometimes
 *  emits objects where we expect strings. Keeps the card from crashing. */
function toDisplayString(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(toDisplayString).filter(Boolean).join('; ');
    if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const nameish = o.name ?? o.display_name ?? o.title;
        if (nameish) return String(nameish);
        return Object.entries(o)
            .filter(([, val]) => val != null && val !== '')
            .map(([k, val]) => `${k}: ${toDisplayString(val)}`)
            .join(' — ');
    }
    return String(v);
}

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

    const handleCreateCourse = async (title: string, keywords: string, pdfData?: ArrayBuffer, description?: string) => {
        if (!title.trim()) return;

        try {
            // Check if description changed
            const descriptionChanged = !editingCourse || description !== editingCourse.description;

            if (editingCourse) {
                // Update existing course
                const updatedCourse: Course = {
                    ...editingCourse,
                    title: title,
                    description: description || '',
                    keywords: keywords,
                    // Keep old syllabus info for now, async task will update it if triggered
                    syllabus_info: editingCourse.syllabus_info,
                    updated_at: new Date().toISOString()
                };
                if (descriptionChanged || pdfData) {
                    await storageService.saveCourseWithSyllabus(updatedCourse, { pdfData, triggerSyllabusGeneration: true });
                } else {
                    await storageService.saveCourse(updatedCourse);
                }

            } else {
                // Create new course
                const newCourseId = crypto.randomUUID();
                const newCourse: Course = {
                    id: newCourseId,
                    user_id: "", // Will be set by storageService
                    title: title,
                    description: description || '',
                    keywords: keywords,
                    syllabus_info: undefined, // Will be populated by async task
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                await storageService.saveCourseWithSyllabus(newCourse, { pdfData, triggerSyllabusGeneration: true });

                // Return ID for auto-save use cases
                setIsDialogOpen(false);
                setEditingCourse(null);
                loadCourses();
                return newCourseId;
            }

            setIsDialogOpen(false);
            setEditingCourse(null);
            loadCourses();
            return editingCourse?.id;
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
        <div className={s.root}>
            <div className={s.header}>
                <h1 className={s.title}>
                    <GraduationCap size={20} className={s.titleIcon} />
                    我的科目
                </h1>
                <button
                    onClick={() => setIsDialogOpen(true)}
                    className={s.btnPrimary}
                >
                    <Plus size={14} />
                    新增科目
                </button>
            </div>

            {courses.length === 0 ? (
                <div className={s.empty}>
                    <GraduationCap size={56} className={s.emptyIcon} />
                    <p className={s.emptyTitle}>還沒有科目</p>
                    <p className={s.emptyHint}>點擊右上角按鈕開始創建您的第一個科目</p>
                </div>
            ) : (
                <div className={s.grid}>
                    {courses.map((course) => (
                        <div
                            key={course.id}
                            onClick={() => onSelectCourse(course.id)}
                            className={s.card}
                        >
                            <div className={s.cardHead}>
                                <h2 className={s.cardTitle}>{course.title}</h2>
                                <div className={s.kebabWrap}>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setMenuOpenId(menuOpenId === course.id ? null : course.id);
                                        }}
                                        className={s.kebab}
                                    >
                                        <MoreVertical size={16} />
                                    </button>

                                    {menuOpenId === course.id && (
                                        <div className={s.menu}>
                                            <button
                                                onClick={(e) => handleEditCourse(course, e)}
                                                className={s.menuItem}
                                            >
                                                <Edit2 size={13} />
                                                編輯
                                            </button>
                                            <button
                                                onClick={(e) => handleDeleteCourse(course.id, e)}
                                                className={`${s.menuItem} ${s.menuItemDanger}`}
                                            >
                                                <Trash2 size={13} />
                                                刪除
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className={s.cardBody}>
                                {course.syllabus_info?.topic ? (
                                    <p className={s.cardSummary}>
                                        {toDisplayString(course.syllabus_info.topic)}
                                    </p>
                                ) : (
                                    <p className={`${s.cardSummary} ${s.cardSummaryFaint}`}>
                                        {course.description || (course.keywords ? `關鍵詞: ${course.keywords}` : '無描述')}
                                    </p>
                                )}
                            </div>

                            <div className={s.cardFooter}>
                                {course.syllabus_info ? (
                                    <>
                                        {course.syllabus_info.instructor && (
                                            <div className={s.metaRow}>
                                                <User size={12} className={`${s.metaIcon} ${s.metaIconAccent}`} />
                                                <span className={s.metaText}>{toDisplayString(course.syllabus_info.instructor)}</span>
                                            </div>
                                        )}
                                        <div className={`${s.metaRow} ${s.metaRowMulti}`}>
                                            {course.syllabus_info.time && (
                                                <div className={s.metaRow} style={{ gap: 6 }}>
                                                    <Clock size={12} className={`${s.metaIcon} ${s.metaIconOk}`} />
                                                    <span className={s.metaText}>{toDisplayString(course.syllabus_info.time)}</span>
                                                </div>
                                            )}
                                            {course.syllabus_info.location && (
                                                <div className={s.metaRow} style={{ gap: 6 }}>
                                                    <MapPin size={12} className={`${s.metaIcon} ${s.metaIconHot}`} />
                                                    <span className={s.metaText} style={{ maxWidth: 80 }}>{toDisplayString(course.syllabus_info.location)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className={s.metaSpread}>
                                        <span className={s.metaRow}>
                                            <Calendar size={12} className={s.metaIcon} />
                                            {course.updated_at ? new Date(course.updated_at).toLocaleDateString() : ''}
                                        </span>
                                        <span className={s.metaCta}>
                                            <BookOpen size={12} />
                                            進入學習
                                        </span>
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
