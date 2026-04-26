import React, { useState, useEffect } from 'react';
import {
    Plus,
    Mic,
    CheckCircle2,
    Clock,
    Calendar,
    ChevronRight,
    BookOpen,
    Hash,
    Pencil,
    MapPin,
    User,
    GraduationCap,
    List,
    FileText,
    Trash2,
    MoreVertical
} from 'lucide-react';
import { Course, Lecture } from '../types';
import {
    storageService,
    getCourseSyllabusState,
    getCourseSyllabusFailureReason
} from '../services/storageService';
import CourseCreationDialog from './CourseCreationDialog';
import { toastService } from '../services/toastService';
import s from './CourseDetailView.module.css';

/**
 * LLM syllabus output is best-effort JSON. Even with strict prompts,
 * fields we typed as `string` occasionally come back as objects or
 * arrays (e.g. `teaching_assistants` returned as
 * `[{name, email, office_hours}, ...]`). Rendering those directly
 * triggers React's "Objects are not valid as a React child" error
 * and crashes the whole CourseDetailView via ErrorBoundary.
 *
 * Normalize anything to a human-readable string before render.
 */
function toDisplayString(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(toDisplayString).filter(Boolean).join('; ');
    if (typeof v === 'object') {
        // Prefer common name-like keys so objects render as something
        // human before falling back to key=value joins.
        const o = v as Record<string, unknown>;
        const nameish = o.name ?? o.display_name ?? o.title;
        const parts: string[] = [];
        if (nameish) parts.push(String(nameish));
        for (const [k, val] of Object.entries(o)) {
            if (k === 'name' || k === 'display_name' || k === 'title') continue;
            if (val == null || val === '') continue;
            parts.push(`${k}: ${toDisplayString(val)}`);
        }
        return parts.join(' — ');
    }
    return String(v);
}

interface CourseDetailViewProps {
    courseId: string;
    onBack: () => void;
    onSelectLecture: (lectureId: string) => void;
    onCreateLecture: (courseId: string) => void;
}

const CourseDetailView: React.FC<CourseDetailViewProps> = ({
    courseId,
    onBack,
    onSelectLecture,
    onCreateLecture
}) => {
    const [course, setCourse] = useState<Course | null>(null);
    const [lectures, setLectures] = useState<Lecture[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);

    useEffect(() => {
        loadData();
    }, [courseId]);

    // 當背景任務（syllabus 抽取 / summary 生成）寫回 storage 後，storageService
    // 會發 `classnote-course-updated` event。如果正在看的就是這個 course，重 fetch
    // 一次，讓「AI 正在生成課程大綱...」spinner 換成結構化內容。
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { courseId?: string } | undefined;
            if (detail?.courseId && detail.courseId === courseId) {
                loadData();
            }
        };
        window.addEventListener('classnote-course-updated', handler);
        return () => window.removeEventListener('classnote-course-updated', handler);
    }, [courseId]);

// 點擊外部關閉菜單（但不在刪除確認期間）
    useEffect(() => {
        const handleClickOutside = () => {
            if (!isDeleting) {
                setMenuOpenId(null);
            }
        };
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, [isDeleting]);

    const handleDeleteLecture = async (lectureId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        console.log('[CourseDetailView] Delete button clicked for lecture:', lectureId);

        setIsDeleting(true);

        try {
            // 使用 Tauri 的原生對話框
            const { confirm } = await import('@tauri-apps/plugin-dialog');
            const confirmed = await confirm(
                '所有相關的字幕和筆記都將被刪除。',
                {
                    title: '確定要刪除此課堂嗎？',
                    kind: 'warning',
                    okLabel: '刪除',
                    cancelLabel: '取消'
                }
            );

            setIsDeleting(false);
            console.log('[CourseDetailView] User confirmed:', confirmed);

            if (confirmed) {
                await storageService.deleteLecture(lectureId);
                console.log('[CourseDetailView] Lecture deleted, reloading list...');
                await loadData();
                setMenuOpenId(null);
            } else {
                console.log('[CourseDetailView] User cancelled deletion');
                setMenuOpenId(null);
            }
        } catch (error) {
            setIsDeleting(false);
            console.error('[CourseDetailView] Error during deletion:', error);
            // 使用 Tauri 對話框顯示錯誤
            try {
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message('刪除失敗，請重試', { title: '錯誤', kind: 'error' });
            } catch {
                alert('刪除失敗，請重試');
            }
        }
    };

    const loadData = async () => {
        try {
            setIsLoading(true);
            const courseData = await storageService.getCourse(courseId);
            setCourse(courseData);

            const lecturesList = await storageService.listLecturesByCourse(courseId);
            setLectures(lecturesList);
        } catch (error) {
            console.error('Failed to load course data:', error);
        } finally {
            setIsLoading(false);
        }
    };
    const handleRetrySyllabusGeneration = async () => {
        if (!course || isRetrying) return;

        try {
            setIsRetrying(true);
            await storageService.retryCourseSyllabusGeneration(course.id);
            const refreshedCourse = await storageService.getCourse(course.id);
            if (refreshedCourse) {
                setCourse(refreshedCourse);
            }
        } catch (error) {
            toastService.error('重試失敗', error instanceof Error ? error.message : String(error));
        } finally {
            setIsRetrying(false);
        }
    };

    const handleUpdateCourse = async (
        title: string,
        keywords: string,
        pdfData?: ArrayBuffer,
        description?: string,
        shouldClose: boolean = true,
    ) => {
        if (!course) return;
        try {
            const descriptionChanged = description !== course.description;

            const updatedCourse: Course = {
                ...course,
                title,
                keywords,
                description: description || '',
                syllabus_info: course.syllabus_info,
                updated_at: new Date().toISOString()
            };
            setCourse(updatedCourse);
            if (descriptionChanged || pdfData) {
                await storageService.saveCourseWithSyllabus(updatedCourse, { pdfData, triggerSyllabusGeneration: true });
            } else {
                await storageService.saveCourse(updatedCourse);
            }
            // Keyword-extraction flow passes shouldClose=false so the
            // dialog stays open while the background LLM call runs
            // and merges the extracted keywords back into the
            // dialog's state. Only close on explicit full saves.
            if (shouldClose) setIsEditDialogOpen(false);
        } catch (error) {
            console.error('Failed to update course:', error);
        }
    };

    if (isLoading) {
        return (
            <div className={s.fullCenter}>
                <div className={s.spinner} />
            </div>
        );
    }

    if (!course) {
        return (
            <div className={s.fullCenter}>
                <p>找不到該科目</p>
                <button onClick={onBack} className={s.linkBtn}>返回首頁</button>
            </div>
        );
    }

    const { syllabus_info } = course;
    const syllabusState = getCourseSyllabusState(syllabus_info);
    const syllabusFailureReason = getCourseSyllabusFailureReason(syllabus_info);

    return (
        <div className={s.root}>
            {/* Header */}
            <div className={s.header}>
                <div className={s.crumb}>
                    <button onClick={onBack} className={s.crumbBack}>HOME</button>
                    <ChevronRight size={12} className={s.crumbSep} />
                    <span className={s.crumbCurrent}>{course.title.toUpperCase()}</span>
                </div>

                <div className={s.titleRow}>
                    <div>
                        <h1 className={s.titleText}>
                            {course.title}
                            <button
                                onClick={() => setIsEditDialogOpen(true)}
                                className={s.editBtn}
                            >
                                <Pencil size={16} />
                            </button>
                        </h1>
                        {course.keywords && (
                            <div className={s.kwChip}>
                                <Hash size={11} />
                                <span>{course.keywords}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Content - 2 Column Layout */}
            <div className={s.body}>
                <div className={s.grid}>
                    {/* Left Column: Syllabus Summary */}
                    <div>
                        <div className={s.card}>
                            <h2 className={s.cardTitle}>
                                <FileText size={16} className={s.cardTitleIcon} />
                                課程大綱
                            </h2>

                            {syllabusState === 'ready' && syllabus_info ? (
                                <>
                                    {syllabus_info.topic && (
                                        <div className={s.section}>
                                            <span className={s.eyebrow}>課程主題</span>
                                            <p className={`${s.synopsis} ${s.synopsisLg}`}>{toDisplayString(syllabus_info.topic)}</p>
                                        </div>
                                    )}

                                    {syllabus_info.time && (
                                        <div className={s.section}>
                                            <div className={s.row}>
                                                <Clock size={14} className={s.rowIcon} />
                                                <div>
                                                    <span className={s.eyebrow}>時間</span>
                                                    <p className={s.synopsis}>{toDisplayString(syllabus_info.time)}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {syllabus_info.instructor && (
                                        <div className={s.section}>
                                            <div className={s.row}>
                                                <User size={14} className={s.rowIcon} />
                                                <div>
                                                    <span className={s.eyebrow}>講師 & 助教</span>
                                                    <p className={`${s.synopsis} ${s.synopsisLg}`}>{toDisplayString(syllabus_info.instructor)}</p>
                                                    {syllabus_info.office_hours && (
                                                        <p className={s.synopsis} style={{ fontSize: 12 }}>
                                                            辦公時間: {toDisplayString(syllabus_info.office_hours)}
                                                        </p>
                                                    )}
                                                    {syllabus_info.teaching_assistants && (
                                                        <p className={s.synopsis} style={{ fontSize: 12 }}>
                                                            助教: {toDisplayString(syllabus_info.teaching_assistants)}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {syllabus_info.location && (
                                        <div className={s.section}>
                                            <div className={s.row}>
                                                <MapPin size={14} className={s.rowIcon} />
                                                <div>
                                                    <span className={s.eyebrow}>地點</span>
                                                    <p className={s.synopsis}>{toDisplayString(syllabus_info.location)}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {syllabus_info.grading && Array.isArray(syllabus_info.grading) && (
                                        <div className={s.section}>
                                            <div className={s.sectionHead}>
                                                <GraduationCap size={14} className={s.rowIcon} />
                                                <span className={s.eyebrow}>評分標準</span>
                                            </div>
                                            <div className={s.tableWrap}>
                                                <table className={s.table}>
                                                    <thead className={s.tableHead}>
                                                        <tr>
                                                            <th className={s.tableHeadCell}>項目</th>
                                                            <th className={`${s.tableHeadCell} ${s.tableHeadCellRight}`}>佔比</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {syllabus_info.grading.map((item, index) => (
                                                            <tr key={index} className={s.tableRow}>
                                                                <td>{toDisplayString(item.item)}</td>
                                                                <td className={s.tableValue}>{toDisplayString(item.percentage)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}

                                    {syllabus_info.schedule && syllabus_info.schedule.length > 0 && (
                                        <div className={s.section}>
                                            <div className={s.sectionHead}>
                                                <List size={14} className={s.rowIcon} />
                                                <span className={s.eyebrow}>每週進度</span>
                                            </div>
                                            <ul className={s.sectionList}>
                                                {syllabus_info.schedule.map((item, index) => (
                                                    <li key={index} className={s.sectionItem}>
                                                        <span className={s.sectionBullet}>·</span>
                                                        <span>{toDisplayString(item)}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </>
                            ) : syllabusState === 'generating' ? (
                                <>
                                    {course.description && (
                                        <p className={s.synopsis} style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>
                                            {course.description}
                                        </p>
                                    )}
                                    <div className={`${s.statePill} ${s.stateGen}`}>
                                        <Clock size={14} />
                                        <span>AI 正在生成課程大綱...</span>
                                    </div>
                                </>
                            ) : syllabusState === 'failed' ? (
                                <div className={`${s.statePill} ${s.stateFail}`}>
                                    <span className={s.stateFailTitle}>生成失敗</span>
                                    {syllabusFailureReason && (
                                        <span className={s.stateFailReason}>{syllabusFailureReason}</span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleRetrySyllabusGeneration}
                                        disabled={isRetrying}
                                        className={s.retryBtn}
                                    >
                                        <Clock size={13} className={isRetrying ? 'animate-spin' : ''} />
                                        <span>{isRetrying ? '重試中...' : '重試生成'}</span>
                                    </button>
                                </div>
                            ) : (
                                <p className={`${s.synopsis} ${s.synopsisFaint}`}>暫無課程大綱信息</p>
                            )}
                        </div>
                    </div>

                    {/* Right Column: Lectures List */}
                    <div>
                        <div className={s.lecturesHeader}>
                            <h2 className={s.lecturesTitle}>
                                <BookOpen size={16} className={s.cardTitleIcon} />
                                課堂列表
                            </h2>
                            <button
                                onClick={() => onCreateLecture(courseId)}
                                className={s.btnPrimary}
                            >
                                <Plus size={13} />
                                新課堂
                            </button>
                        </div>

                        {lectures.length === 0 ? (
                            <div className={s.lectureEmpty}>
                                <BookOpen size={56} className={s.lectureEmptyIcon} />
                                <p className={s.lectureEmptyTitle}>此科目還沒有課堂記錄</p>
                                <button
                                    onClick={() => onCreateLecture(courseId)}
                                    className={s.lectureEmptyCta}
                                >
                                    開始第一堂課
                                </button>
                            </div>
                        ) : (
                            <div className={s.lectureList}>
                                {lectures.map((lecture) => (
                                    <div
                                        key={lecture.id}
                                        onClick={() => onSelectLecture(lecture.id)}
                                        className={s.lectureRow}
                                    >
                                        <div
                                            className={`${s.statusGlyph} ${lecture.status === 'recording' ? s.statusGlyphRecording : s.statusGlyphReady}`}
                                        >
                                            {lecture.status === 'recording' ? (
                                                <Mic size={16} />
                                            ) : (
                                                <CheckCircle2 size={16} />
                                            )}
                                        </div>

                                        <div className={s.lectureMeta}>
                                            <h3 className={s.lectureTitle}>{lecture.title}</h3>
                                            <div className={s.lectureSub}>
                                                <span className={s.lectureChip}>
                                                    <Calendar size={11} />
                                                    {new Date(lecture.date).toLocaleDateString()}
                                                </span>
                                                {lecture.duration > 0 && (
                                                    <span className={s.lectureChip}>
                                                        <Clock size={11} />
                                                        {Math.floor(lecture.duration / 60)} min
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className={s.kebabWrap}>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setMenuOpenId(menuOpenId === lecture.id ? null : lecture.id);
                                                }}
                                                className={s.kebab}
                                            >
                                                <MoreVertical size={15} />
                                            </button>

                                            {menuOpenId === lecture.id && (
                                                <div className={s.menu}>
                                                    <button
                                                        onClick={(e) => handleDeleteLecture(lecture.id, e)}
                                                        className={s.menuItem}
                                                    >
                                                        <Trash2 size={13} />
                                                        刪除課堂
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <ChevronRight size={16} className={s.arrow} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {course && (
                <CourseCreationDialog
                    isOpen={isEditDialogOpen}
                    onClose={() => setIsEditDialogOpen(false)}
                    onSubmit={handleUpdateCourse}
                    initialTitle={course.title}
                    initialKeywords={course.keywords}
                    initialDescription={course.description}
                    mode="edit"
                />
            )}
        </div>
    );
};

export default CourseDetailView;
