/**
 * H18DeepApp · v0.7.0 Phase 6.1 chrome shell
 *
 * 對應 docs/design/h18-deep/h18-app.jsx (H18DeepApp + H18Layout +
 * H18MainContent dispatcher)。
 *
 * P6.1 範圍：上 chrome (TopBar + Rail) 跟 router state machine。
 * 各 nav target 還沒整片重寫的部分先 fall back 到 legacy view，
 * 等 P6.2 ~ P6.7 一片片換。
 *
 * fallback / placeholder 對照表：
 *   home              → Inbox/Calendar placeholder（P6.2 接）
 *   notes             → 知識庫 placeholder（P6.9）
 *   ai                → AIPage placeholder（P6.6）
 *   profile           → Profile placeholder + 入口（legacy SettingsView /
 *                       ProfileView 暫時透過 placeholder 入口開）
 *   course:id         → legacy CourseDetailView
 *   recording:id      → legacy NotesView (mode 內部 auto-detect)
 *   review:id:lecId   → legacy NotesView
 *   add (overlay)     → legacy CourseCreationDialog
 *   search (overlay)  → 文字 stub（P6.8 真做）
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { applyTheme, getSystemTheme } from '../../utils/theme';
import { storageService } from '../../services/storageService';
import type { Course } from '../../types';
import {
    parseNav,
    type H18ActiveNav,
    type H18OverlayNav,
} from '../../types/h18Nav';
import H18TopBar from './H18TopBar';
import H18Rail from './H18Rail';
import HomeLayout from './HomeLayout';
import CourseDetailPage from './CourseDetailPage';
import AddCourseDialog from './AddCourseDialog';
import H18ReviewPage from './H18ReviewPage';
import SettingsView from '../SettingsView';
import TrashView from '../TrashView';
import s from './H18DeepApp.module.css';

interface PlaceholderProps {
    eyebrow: string;
    title: string;
    hint: string;
    actionLabel?: string;
    onAction?: () => void;
}

function Placeholder({ eyebrow, title, hint, actionLabel, onAction }: PlaceholderProps) {
    return (
        <div className={s.placeholder}>
            <div className={s.placeholderEyebrow}>{eyebrow}</div>
            <h2 className={s.placeholderTitle}>{title}</h2>
            <p className={s.placeholderHint}>{hint}</p>
            {actionLabel && onAction && (
                <button
                    type="button"
                    onClick={onAction}
                    style={{
                        marginTop: 16,
                        padding: '6px 14px',
                        fontSize: 12,
                        fontWeight: 700,
                        border: '1px solid var(--h18-border)',
                        borderRadius: 8,
                        background: 'var(--h18-surface)',
                        color: 'var(--h18-text)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                    }}
                >
                    {actionLabel}
                </button>
            )}
        </div>
    );
}

export default function H18DeepApp() {
    const [activeNav, setActiveNav] = useState<H18ActiveNav>('home');
    const [overlayNav, setOverlayNav] = useState<H18OverlayNav>(null);
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [courses, setCourses] = useState<Course[]>([]);
    /** Course shown in HomeLayout's Preview pane. Independent from
     *  activeNav — you can stay on home and inspect course X. */
    const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
    const [isCourseDialogOpen, setIsCourseDialogOpen] = useState(false);

    // P6.7 之前 legacy settings / trash 還是要能開 — 從 profile placeholder
    // 進入點觸發。Profile (achievement) 暫時不接，等 P6.7。
    const [isLegacySettingsOpen, setIsLegacySettingsOpen] = useState(false);
    const [isTrashOpen, setIsTrashOpen] = useState(false);

    // expose globally for SettingsView's "manage trash" button (parity with MainWindow)
    useEffect(() => {
        (window as unknown as Record<string, unknown>).__setShowTrashView = setIsTrashOpen;
        return () => {
            delete (window as unknown as Record<string, unknown>).__setShowTrashView;
        };
    }, []);

    // ─── theme bootstrap ────────────────────────────────────────────
    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        let cancelled = false;
        const loadTheme = async () => {
            try {
                const settings = await storageService.getAppSettings();
                if (cancelled) return;
                if (settings?.theme) setTheme(settings.theme as 'light' | 'dark');
                else setTheme(getSystemTheme());
            } catch (err) {
                console.warn('[H18DeepApp] theme load failed:', err);
                if (!cancelled) setTheme(getSystemTheme());
            }
        };
        loadTheme();
        return () => {
            cancelled = true;
        };
    }, []);

    // ─── courses load (rail chips) ──────────────────────────────────
    const reloadCourses = useCallback(async () => {
        try {
            const list = await storageService.listCourses();
            setCourses(list);
            // first-time: pick the first course as preview default
            setSelectedCourseId((cur) => cur || list[0]?.id || null);
        } catch (err) {
            console.warn('[H18DeepApp] listCourses failed:', err);
            setCourses([]);
        }
    }, []);

    useEffect(() => {
        reloadCourses();
        const onChange = () => {
            reloadCourses();
        };
        window.addEventListener('classnote-courses-changed', onChange);
        return () => window.removeEventListener('classnote-courses-changed', onChange);
    }, [reloadCourses]);

    // ─── theme toggle (persist) ─────────────────────────────────────
    const toggleTheme = useCallback(async () => {
        const next: 'light' | 'dark' = theme === 'light' ? 'dark' : 'light';
        setTheme(next);
        try {
            const settings = await storageService.getAppSettings();
            if (settings) {
                await storageService.saveAppSettings({ ...settings, theme: next });
            }
        } catch (err) {
            console.warn('[H18DeepApp] theme persist failed:', err);
        }
    }, [theme]);

    // ─── nav handler ────────────────────────────────────────────────
    const handleNav = useCallback((target: H18ActiveNav | 'add') => {
        if (target === 'add') {
            setIsCourseDialogOpen(true);
            return;
        }
        // Hopping to a course-shaped nav target also pins the home Preview
        // to that course, so when the user comes back to home they see
        // the course they were last looking at.
        if (typeof target === 'string') {
            if (target.startsWith('course:')) setSelectedCourseId(target.slice('course:'.length));
            else if (target.startsWith('review:')) setSelectedCourseId(target.slice('review:'.length).split(':')[0]);
            else if (target.startsWith('recording:')) setSelectedCourseId(target.slice('recording:'.length));
        }
        setActiveNav(target);
        setOverlayNav(null);
    }, []);

    // ─── keyboard shortcuts ─────────────────────────────────────────
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const meta = e.metaKey || e.ctrlKey;
            if (meta && e.key === '\\') {
                e.preventDefault();
                void toggleTheme();
                return;
            }
            if (meta && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setOverlayNav('search');
                return;
            }
            if (meta && (e.key.toLowerCase() === 'j' || e.key === '/')) {
                e.preventDefault();
                // P6.6 之前先把 ⌘J 當 ai page 入口（沒有 dock 就直接全螢幕）
                setActiveNav('ai');
                setOverlayNav(null);
                return;
            }
            if (e.key === 'Escape') {
                if (overlayNav) setOverlayNav(null);
                else if (isCourseDialogOpen) setIsCourseDialogOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [toggleTheme, overlayNav, isCourseDialogOpen]);

    // ─── recording entry from topbar ────────────────────────────────
    const parsed = useMemo(() => parseNav(activeNav), [activeNav]);
    const canStartRecording = parsed.kind === 'course';
    const startRecording = canStartRecording
        ? () => setActiveNav(`recording:${parsed.courseId}`)
        : undefined;

    // ─── main content dispatch ──────────────────────────────────────
    const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null;

    const renderMain = () => {
        switch (parsed.kind) {
            case 'home':
                return (
                    <HomeLayout
                        courses={courses}
                        selectedCourse={selectedCourse}
                        effectiveTheme={theme}
                        onPickCourse={(id) => setSelectedCourseId(id)}
                        onOpenCourse={(id) => setActiveNav(`course:${id}`)}
                        onOpenLecture={(courseId, lectureId) =>
                            setActiveNav(`review:${courseId}:${lectureId}`)
                        }
                    />
                );
            case 'notes':
                return (
                    <Placeholder
                        eyebrow="知識庫 · P6.9 預定"
                        title="跨課筆記與白板"
                        hint="doc / canvas / split 三模式編輯器、LaTeX equation block、iPad mirror。新功能 scope，等 chrome ship 後再決定要不要做。"
                    />
                );
            case 'ai':
                return (
                    <Placeholder
                        eyebrow="AI 助教 · P6.6 預定"
                        title="全螢幕對話"
                        hint="會放原本 AIChatWindow 的 detached 視窗體驗。⌘J 暫時也跳這頁；P6.6 補上浮動 AIDock 之後 ⌘J 會切回 dock。"
                    />
                );
            case 'profile':
                return (
                    <Placeholder
                        eyebrow="個人頁 · P6.7 預定"
                        title="Overview + 7 個設置 sub-pane"
                        hint="P6.7 才會把 ProfileView / SettingsView / TrashView 折成 H18 ProfilePage。在那之前用下方按鈕暫時打開 legacy 視圖。"
                        actionLabel="開啟 legacy 設置"
                        onAction={() => setIsLegacySettingsOpen(true)}
                    />
                );
            case 'course':
            case 'recording':
                return (
                    <CourseDetailPage
                        courseId={parsed.courseId}
                        onBack={() => setActiveNav('home')}
                        onSelectLecture={(lectureId: string) =>
                            setActiveNav(`review:${parsed.courseId}:${lectureId}`)
                        }
                        onCreateLecture={() => {
                            void (async () => {
                                try {
                                    const id = crypto.randomUUID();
                                    const now = new Date().toISOString();
                                    await storageService.saveLecture({
                                        id,
                                        course_id: parsed.courseId,
                                        title: '新課堂',
                                        date: now,
                                        duration: 0,
                                        status: 'recording',
                                        created_at: now,
                                        updated_at: now,
                                    });
                                    setActiveNav(`review:${parsed.courseId}:${id}`);
                                } catch (err) {
                                    console.error('[H18DeepApp] create lecture failed:', err);
                                }
                            })();
                        }}
                    />
                );
            case 'review':
                return (
                    <H18ReviewPage
                        courseId={parsed.courseId}
                        lectureId={parsed.lectureId}
                        onBack={() => setActiveNav(`course:${parsed.courseId}`)}
                    />
                );
        }
    };

    return (
        <div className={s.root}>
            <H18TopBar
                showWindowControls
                onOpenSearch={() => setOverlayNav('search')}
                onStartRecording={startRecording}
                canStartRecording={canStartRecording}
                effectiveTheme={theme}
                onToggleTheme={() => void toggleTheme()}
            />
            <div className={s.layout}>
                <H18Rail
                    activeNav={activeNav}
                    onNav={handleNav}
                    courses={courses}
                    avatarInitial="U"
                />
                <main className={s.main}>{renderMain()}</main>
            </div>

            {/* AI dock fab — P6.6 真接 AIDock 之前先當 ai-page 入口 */}
            {parsed.kind !== 'ai' && (
                <button
                    type="button"
                    className={s.fab}
                    title="問 AI (⌘J)"
                    aria-label="AI 助教"
                    onClick={() => setActiveNav('ai')}
                >
                    ✦
                </button>
            )}

            {/* ⌘K stub — P6.8 才接全域搜尋 */}
            {overlayNav === 'search' && (
                <div className={s.stubOverlay} onClick={() => setOverlayNav(null)}>
                    <div className={s.stubCard} onClick={(e) => e.stopPropagation()}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                            ⌘K 全域搜尋
                        </div>
                        <div>P6.8 才會接 minisearch index — 先當佔位。</div>
                        <div className={s.stubKbd}>ESC · 關閉</div>
                    </div>
                </div>
            )}

            {/* 新增課程 dialog — H18 重寫版 (P6.3) */}
            <AddCourseDialog
                isOpen={isCourseDialogOpen}
                onClose={() => setIsCourseDialogOpen(false)}
                onSubmit={async (title, keywords, pdfData, description) => {
                    if (!title.trim()) return;
                    try {
                        const newCourseId = crypto.randomUUID();
                        const now = new Date().toISOString();
                        await storageService.saveCourseWithSyllabus(
                            {
                                id: newCourseId,
                                user_id: '',
                                title,
                                description: description || '',
                                keywords,
                                syllabus_info: undefined,
                                created_at: now,
                                updated_at: now,
                            },
                            { pdfData, triggerSyllabusGeneration: true },
                        );
                        setIsCourseDialogOpen(false);
                        await reloadCourses();
                        setActiveNav(`course:${newCourseId}`);
                        return newCourseId;
                    } catch (err) {
                        console.error('[H18DeepApp] create course failed:', err);
                    }
                }}
            />

            {/* legacy settings / trash — P6.7 之後拔 */}
            {isLegacySettingsOpen && (
                <SettingsView onClose={() => setIsLegacySettingsOpen(false)} />
            )}
            {isTrashOpen && <TrashView onBack={() => setIsTrashOpen(false)} />}
        </div>
    );
}
