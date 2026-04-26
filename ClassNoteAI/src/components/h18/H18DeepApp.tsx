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
import { courseColor, courseShort } from './courseColor';
import HomeLayout from './HomeLayout';
import CourseDetailPage from './CourseDetailPage';
import AddCourseDialog from './AddCourseDialog';
import H18ReviewPage from './H18ReviewPage';
import H18AIDock from './H18AIDock';
import H18AIPage from './H18AIPage';
import ProfilePage from './ProfilePage';
import NotesEditorPage from './NotesEditorPage';
import SearchOverlay, { type SearchAction } from './SearchOverlay';
import s from './H18DeepApp.module.css';

// (Placeholder helper removed in P6.9 — every nav target now has a real component)

export default function H18DeepApp() {
    const [activeNav, setActiveNav] = useState<H18ActiveNav>('home');
    const [overlayNav, setOverlayNav] = useState<H18OverlayNav>(null);
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [courses, setCourses] = useState<Course[]>([]);
    /** Course shown in HomeLayout's Preview pane. Independent from
     *  activeNav — you can stay on home and inspect course X. */
    const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
    const [isCourseDialogOpen, setIsCourseDialogOpen] = useState(false);
    const [aiDockOpen, setAiDockOpen] = useState(false);


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

    // ─── active recording detection (TopBar 中央 island) ─────────────
    const [activeRecLecture, setActiveRecLecture] = useState<{
        lectureId: string;
        courseId: string;
        startedAtMs: number;
    } | null>(null);
    const [recElapsedSec, setRecElapsedSec] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const probe = async () => {
            try {
                const all = await storageService.listLectures();
                const rec = all.find((l) => l.status === 'recording');
                if (cancelled) return;
                if (rec) {
                    const startedAtMs = new Date(rec.updated_at || rec.created_at).getTime();
                    setActiveRecLecture({
                        lectureId: rec.id,
                        courseId: rec.course_id,
                        startedAtMs,
                    });
                } else {
                    setActiveRecLecture(null);
                }
            } catch {
                /* swallow */
            }
        };
        probe();
        const id = setInterval(probe, 4000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    // tick elapsed once a second while recording
    useEffect(() => {
        if (!activeRecLecture) {
            setRecElapsedSec(0);
            return;
        }
        const tick = () => {
            setRecElapsedSec(
                Math.max(0, Math.floor((Date.now() - activeRecLecture.startedAtMs) / 1000)),
            );
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [activeRecLecture]);

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
                setAiDockOpen((v) => !v);
                return;
            }
            if (e.key === 'Escape') {
                if (aiDockOpen) setAiDockOpen(false);
                else if (overlayNav) setOverlayNav(null);
                else if (isCourseDialogOpen) setIsCourseDialogOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [toggleTheme, overlayNav, isCourseDialogOpen, aiDockOpen]);

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
                return <NotesEditorPage onBack={() => setActiveNav('home')} />;
            case 'ai':
                return <H18AIPage onBack={() => setActiveNav('home')} />;
            case 'profile':
                return (
                    <ProfilePage
                        onBack={() => setActiveNav('home')}
                        effectiveTheme={theme}
                        onToggleTheme={() => void toggleTheme()}
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

    // Build active recording payload for TopBar island
    const activeRecCourse = activeRecLecture
        ? courses.find((c) => c.id === activeRecLecture.courseId)
        : null;
    const activeRecording = activeRecLecture && activeRecCourse
        ? {
              courseShort: courseShort(
                  activeRecCourse.title,
                  activeRecCourse.keywords,
              ),
              courseColor: courseColor(activeRecCourse.id),
              lectureNumber: '—',
              elapsedSec: recElapsedSec,
              onClick: () =>
                  setActiveNav(
                      `review:${activeRecLecture.courseId}:${activeRecLecture.lectureId}`,
                  ),
          }
        : null;

    return (
        <div className={s.root}>
            <H18TopBar
                showWindowControls
                onOpenSearch={() => setOverlayNav('search')}
                onStartRecording={startRecording}
                canStartRecording={canStartRecording}
                effectiveTheme={theme}
                onToggleTheme={() => void toggleTheme()}
                inboxCount={0}
                onOpenInbox={() => setActiveNav('home')}
                activeRecording={activeRecording}
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

            {/* AI dock fab — opens floating ⌘J dock; ai page hides it */}
            {parsed.kind !== 'ai' && !aiDockOpen && (
                <button
                    type="button"
                    className={s.fab}
                    title="問 AI (⌘J)"
                    aria-label="AI 助教"
                    onClick={() => setAiDockOpen(true)}
                >
                    ✦
                </button>
            )}

            {/* H18 AIDock floating overlay (⌘J 切換) */}
            <H18AIDock
                open={aiDockOpen}
                onClose={() => setAiDockOpen(false)}
                onExpand={() => {
                    setAiDockOpen(false);
                    setActiveNav('ai');
                }}
                contextHint={
                    parsed.kind === 'course'
                        ? courses.find((c) => c.id === parsed.courseId)?.title
                        : parsed.kind === 'review' || parsed.kind === 'recording'
                          ? courses.find((c) => c.id === parsed.courseId)?.title
                          : undefined
                }
            />

            <SearchOverlay
                open={overlayNav === 'search'}
                onClose={() => setOverlayNav(null)}
                onAction={(action: SearchAction) => {
                    switch (action.kind) {
                        case 'open-course':
                            setActiveNav(`course:${action.courseId}`);
                            break;
                        case 'open-lecture':
                            setActiveNav(`review:${action.courseId}:${action.lectureId}`);
                            break;
                        case 'home':
                            setActiveNav('home');
                            break;
                        case 'add-course':
                            setIsCourseDialogOpen(true);
                            break;
                        case 'open-ai':
                            setActiveNav('ai');
                            break;
                        case 'open-settings':
                            setActiveNav('profile');
                            break;
                    }
                }}
            />

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

        </div>
    );
}
