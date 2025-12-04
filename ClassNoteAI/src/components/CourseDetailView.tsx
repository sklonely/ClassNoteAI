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
    FileText
} from 'lucide-react';
import { Course, Lecture } from '../types';
import { storageService } from '../services/storageService';
import { ollamaService } from '../services/ollamaService';
import CourseCreationDialog from './CourseCreationDialog';

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

    useEffect(() => {
        loadData();
    }, [courseId]);

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

    const handleUpdateCourse = async (title: string, keywords: string, _pdfData?: ArrayBuffer, description?: string) => {
        if (!course) return;
        try {
            let syllabusInfo = undefined;

            // Only extract if description changed and is long enough
            const descriptionChanged = description !== course.description;

            if (descriptionChanged && description && description.trim().length > 50) {
                // 如果有足夠長的描述，嘗試提取結構化信息
                console.log('[CourseDetailView] Extracting syllabus info...');
                const extracted = await ollamaService.extractSyllabusInfo(description);
                console.log('[CourseDetailView] Extracted syllabus info:', extracted);

                // Only use if extraction was successful (has keys)
                if (extracted && Object.keys(extracted).length > 0) {
                    syllabusInfo = extracted;
                }
            }

            const updatedCourse: Course = {
                ...course,
                title,
                keywords,
                description: description || '',
                syllabus_info: syllabusInfo || course.syllabus_info, // 保留舊的或使用新的
                updated_at: new Date().toISOString()
            };
            await storageService.saveCourse(updatedCourse);
            setCourse(updatedCourse);
            setIsEditDialogOpen(false);
        } catch (error) {
            console.error('Failed to update course:', error);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!course) {
        return (
            <div className="p-6 text-center text-gray-500">
                <p>找不到該科目</p>
                <button onClick={onBack} className="mt-4 text-blue-600 hover:underline">返回首頁</button>
            </div>
        );
    }

    const { syllabus_info } = course;

    return (
        <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 shadow-sm z-10">
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
                    <button onClick={onBack} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">首頁</button>
                    <ChevronRight className="w-4 h-4" />
                    <span className="text-gray-800 dark:text-gray-200 font-medium">{course.title}</span>
                </div>

                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            {course.title}
                            <button
                                onClick={() => setIsEditDialogOpen(true)}
                                className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                <Pencil className="w-5 h-5" />
                            </button>
                        </h1>
                        {course.keywords && (
                            <div className="flex items-center gap-2 mt-2 text-sm text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded w-fit">
                                <Hash className="w-3 h-3" />
                                <span>{course.keywords}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Content - 2 Column Layout */}
            <div className="flex-1 overflow-auto p-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
                    {/* Left Column: Syllabus Summary */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
                                <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                課程大綱
                            </h2>

                            {syllabus_info ? (
                                <div className="space-y-4">
                                    {syllabus_info.topic && (
                                        <div>
                                            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">課程主題</h3>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">{syllabus_info.topic}</p>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 gap-3">
                                        {syllabus_info.time && (
                                            <div className="flex items-start gap-2">
                                                <Clock className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                                                <div>
                                                    <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">時間</h3>
                                                    <p className="text-sm text-gray-700 dark:text-gray-300">{syllabus_info.time}</p>
                                                </div>
                                            </div>
                                        )}
                                        {syllabus_info.instructor && (
                                            <div className="flex items-start gap-2">
                                                <User className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                                                <div>
                                                    <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">講師 & 助教</h3>
                                                    <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">{syllabus_info.instructor}</p>
                                                    {syllabus_info.office_hours && (
                                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                                            辦公時間: {syllabus_info.office_hours}
                                                        </p>
                                                    )}
                                                    {syllabus_info.teaching_assistants && (
                                                        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/50">
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                                <span className="font-medium">助教:</span> {syllabus_info.teaching_assistants}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        {syllabus_info.location && (
                                            <div className="flex items-start gap-2">
                                                <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                                                <div>
                                                    <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">地點</h3>
                                                    <p className="text-sm text-gray-700 dark:text-gray-300">{syllabus_info.location}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {syllabus_info.grading && Array.isArray(syllabus_info.grading) && (
                                        <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
                                            <div className="flex items-center gap-2 mb-2">
                                                <GraduationCap className="w-4 h-4 text-gray-400" />
                                                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">評分標準</h3>
                                            </div>
                                            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                                                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                                    <thead className="bg-gray-50 dark:bg-gray-800">
                                                        <tr>
                                                            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">項目</th>
                                                            <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">佔比</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-gray-700">
                                                        {syllabus_info.grading.map((item, index) => (
                                                            <tr key={index}>
                                                                <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{item.item}</td>
                                                                <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 text-right font-medium">{item.percentage}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}

                                    {syllabus_info.schedule && syllabus_info.schedule.length > 0 && (
                                        <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
                                            <div className="flex items-center gap-2 mb-2">
                                                <List className="w-4 h-4 text-gray-400" />
                                                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">每週進度</h3>
                                            </div>
                                            <ul className="space-y-1">
                                                {syllabus_info.schedule.map((item, index) => (
                                                    <li key={index} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2">
                                                        <span className="text-gray-400 text-xs mt-0.5">•</span>
                                                        <span>{item}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                    {course.description ? (
                                        <p className="whitespace-pre-wrap">{course.description}</p>
                                    ) : (
                                        <p className="italic">暫無課程大綱信息</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Column: Lectures List */}
                    <div className="lg:col-span-2">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                                <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                課堂列表
                            </h2>
                            <button
                                onClick={() => onCreateLecture(courseId)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                            >
                                <Plus className="w-4 h-4" />
                                新課堂
                            </button>
                        </div>

                        {lectures.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-500 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-slate-800">
                                <BookOpen className="w-16 h-16 mb-4 opacity-20" />
                                <p className="text-lg font-medium">此科目還沒有課堂記錄</p>
                                <button
                                    onClick={() => onCreateLecture(courseId)}
                                    className="mt-4 text-blue-600 dark:text-blue-400 hover:underline font-medium"
                                >
                                    開始第一堂課
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {lectures.map((lecture) => (
                                    <div
                                        key={lecture.id}
                                        onClick={() => onSelectLecture(lecture.id)}
                                        className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-500/30 transition-all cursor-pointer flex items-center gap-4 group"
                                    >
                                        {/* Status Icon */}
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${lecture.status === 'recording'
                                            ? 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 animate-pulse'
                                            : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                            }`}>
                                            {lecture.status === 'recording' ? (
                                                <Mic className="w-5 h-5" />
                                            ) : (
                                                <CheckCircle2 className="w-5 h-5" />
                                            )}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                                                {lecture.title}
                                            </h3>
                                            <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mt-1">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="w-3.5 h-3.5" />
                                                    {new Date(lecture.date).toLocaleDateString()}
                                                </div>
                                                {lecture.duration > 0 && (
                                                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-xs">
                                                        <Clock className="w-3 h-3" />
                                                        {Math.floor(lecture.duration / 60)} min
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Arrow */}
                                        <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors" />
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
