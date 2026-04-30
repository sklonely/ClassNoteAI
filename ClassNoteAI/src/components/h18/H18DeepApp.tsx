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
import {
    loadCanvasCache,
    subscribeCanvasCache,
} from '../../services/canvasCacheService';
import type { Course } from '../../types';
import {
    parseNav,
    type H18ActiveNav,
    type H18OverlayNav,
} from '../../types/h18Nav';
import H18TopBar from './H18TopBar';
import H18Rail from './H18Rail';
import { keymapService } from '../../services/keymapService';
import { courseColor, courseShort } from './courseColor';
import { recordingSessionService } from '../../services/recordingSessionService';
import type { RecordingSessionState } from '../../services/__contracts__/recordingSessionService.contract';
import { confirmService } from '../../services/confirmService';
import { toastService } from '../../services/toastService';
import { fmtElapsed } from './useRecordingSession';
import { useAggregatedCanvasInbox } from './useAggregatedCanvasInbox';
import {
    getInboxState,
    subscribeInboxStates,
} from '../../services/inboxStateService';
import HomeLayout from './HomeLayout';
import CourseDetailPage from './CourseDetailPage';
import CourseEditPage from './CourseEditPage';
import AddCourseDialog from './AddCourseDialog';
import H18ReviewPage from './H18ReviewPage';
import H18AIDock from './H18AIDock';
import H18AIPage from './H18AIPage';
import ProfilePage from './ProfilePage';
import NotesEditorComingSoon from './NotesEditorComingSoon';
import DraggableAIFab from './DraggableAIFab';
import SearchOverlay, { type SearchAction } from './SearchOverlay';
import { H18TextContextMenu } from './H18TextContextMenu';
import {
    deriveAIContextForPage,
    loadLastReview,
    storeLastReview,
    type LastReviewState,
} from './aiContextDerivation';
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
    const [addCoursePrefill, setAddCoursePrefill] = useState<
        { title?: string; canvasCourseId?: string } | undefined
    >(undefined);
    const [aiDockOpen, setAiDockOpen] = useState(false);

    // ─── S3b-2 · text context menu state ────────────────────────────
    // A global `contextmenu` listener (below) watches for right-clicks
    // on any input / textarea / contentEditable surface and pops a
    // H18TextContextMenu at the click coords. Component-level context
    // menus (CourseRailContextMenu, future LectureContextMenu) live on
    // their own elements and use stopPropagation; events that reach
    // document have already been ignored by them.
    const [textMenuState, setTextMenuState] = useState<{
        x: number;
        y: number;
        target: HTMLElement;
    } | null>(null);

    // ─── theme bootstrap ────────────────────────────────────────────
    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        let cancelled = false;
        let osMediaQuery: MediaQueryList | null = null;
        let osChangeHandler: ((e: MediaQueryListEvent) => void) | null = null;
        const detachOsListener = () => {
            if (osMediaQuery && osChangeHandler) {
                try {
                    osMediaQuery.removeEventListener('change', osChangeHandler);
                } catch {
                    /* swallow */
                }
            }
            osMediaQuery = null;
            osChangeHandler = null;
        };

        const loadTheme = async () => {
            try {
                const settings = await storageService.getAppSettings();
                if (cancelled) return;

                // cp75: prefer the v0.7 `appearance.themeMode` ('system' /
                // 'light' / 'dark') over the legacy `theme` field. Until
                // this fix the boot path read only `settings.theme`, so
                // PAppearance writing `appearance.themeMode = 'system'`
                // had no runtime effect.
                const mode = settings?.appearance?.themeMode;
                detachOsListener();

                if (mode === 'system') {
                    const apply = () => setTheme(getSystemTheme());
                    apply();
                    if (typeof window !== 'undefined' && window.matchMedia) {
                        osMediaQuery = window.matchMedia(
                            '(prefers-color-scheme: dark)',
                        );
                        osChangeHandler = () => apply();
                        try {
                            osMediaQuery.addEventListener('change', osChangeHandler);
                        } catch {
                            /* legacy browsers — skip */
                        }
                    }
                    return;
                }
                if (mode === 'light' || mode === 'dark') {
                    setTheme(mode);
                    return;
                }
                // Fall back to legacy `theme` field for users who never
                // touched the new "follow system" toggle.
                if (settings?.theme) {
                    setTheme(settings.theme as 'light' | 'dark');
                } else {
                    setTheme(getSystemTheme());
                }
            } catch (err) {
                console.warn('[H18DeepApp] theme load failed:', err);
                if (!cancelled) setTheme(getSystemTheme());
            }
        };
        loadTheme();
        const onSettingsChange = () => loadTheme();
        window.addEventListener('classnote-settings-changed', onSettingsChange);
        return () => {
            cancelled = true;
            detachOsListener();
            window.removeEventListener(
                'classnote-settings-changed',
                onSettingsChange,
            );
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

    // ─── virtual (unpaired Canvas) courses for the rail ─────────────
    // Pull from the cached Canvas calendar feed; show what we know about
    // but the user hasn't created/paired/ignored locally yet.
    const [virtualCourses, setVirtualCourses] = useState<
        { canvasCourseId: string; fullTitle: string }[]
    >([]);

    const recomputeVirtual = useCallback(async () => {
        try {
            const cache = loadCanvasCache<{
                courses: { canvasCourseId: string; fullTitle: string }[];
            }>('calendar:global');
            if (!cache?.data?.courses) {
                setVirtualCourses([]);
                return;
            }
            const settings = await storageService.getAppSettings();
            const ignored = new Set(
                settings?.integrations?.canvas?.ignored_course_ids ?? [],
            );
            const localCanvasIds = new Set(
                courses
                    .map((c) => c.canvas_course_id)
                    .filter((x): x is string => !!x),
            );
            const virtual = cache.data.courses.filter(
                (c) =>
                    !localCanvasIds.has(c.canvasCourseId) &&
                    !ignored.has(c.canvasCourseId),
            );
            setVirtualCourses(virtual);
        } catch (err) {
            console.warn('[H18DeepApp] recomputeVirtual failed:', err);
            setVirtualCourses([]);
        }
    }, [courses]);

    useEffect(() => {
        void recomputeVirtual();
        const off = subscribeCanvasCache('calendar:global', () => {
            void recomputeVirtual();
        });
        const onSettings = () => void recomputeVirtual();
        window.addEventListener('classnote-settings-changed', onSettings);
        return () => {
            off();
            window.removeEventListener('classnote-settings-changed', onSettings);
        };
    }, [recomputeVirtual]);

    // ─── active recording detection (TopBar 中央 island) ─────────────
    // S1.3 — subscribe to recordingSessionService instead of polling
    // listLectures every 30 s. The singleton is the authoritative source
    // while a session is live; we keep one slow safety-net DB probe
    // (90 s) for recovery on launch / external writes / multi-tab edge
    // cases — but it only fires while the singleton is idle so we don't
    // fight the in-memory state.
    const [activeRecLecture, setActiveRecLecture] = useState<{
        lectureId: string;
        courseId: string;
        startedAtMs: number;
    } | null>(null);
    const [recElapsedSec, setRecElapsedSec] = useState(0);

    // Singleton subscription — drives both lecture identity and elapsed
    // counter. Singleton ticks elapsed at 4 Hz internally; floor to whole
    // seconds for the TopBar pill.
    useEffect(() => {
        const apply = (next: RecordingSessionState) => {
            const live =
                next.status === 'recording' ||
                next.status === 'paused' ||
                next.status === 'stopping';
            if (live && next.lectureId && next.courseId) {
                const courseId = next.courseId;
                const lectureId = next.lectureId;
                const startedAtMs = next.sessionStartMs ?? Date.now();
                setActiveRecLecture((cur) => {
                    if (
                        cur &&
                        cur.lectureId === lectureId &&
                        cur.courseId === courseId
                    ) {
                        return cur;
                    }
                    return { lectureId, courseId, startedAtMs };
                });
                setRecElapsedSec(Math.max(0, Math.floor(next.elapsed)));
            } else {
                setActiveRecLecture(null);
                setRecElapsedSec(0);
            }
        };
        // Push initial snapshot then subscribe — subscribe() also fires
        // synchronously on register, so this is mostly defensive.
        apply(recordingSessionService.getState());
        const unsub = recordingSessionService.subscribe(apply);
        return unsub;
    }, []);

    // Recovery probe — finds a lecture row left in status='recording'
    // from a previous app session (e.g. crash). Runs once at mount, and
    // then every 90 s as a safety-net while the singleton is idle.
    useEffect(() => {
        let cancelled = false;
        const probe = async () => {
            // Don't fight the singleton — if a session is live, the
            // subscription above already owns activeRecLecture.
            if (recordingSessionService.getState().status !== 'idle') return;
            try {
                const all = await storageService.listLectures();
                const rec = all.find((l) => l.status === 'recording');
                if (cancelled) return;
                if (rec) {
                    setActiveRecLecture((cur) => {
                        if (cur && cur.lectureId === rec.id) return cur;
                        return {
                            lectureId: rec.id,
                            courseId: rec.course_id,
                            startedAtMs: new Date(
                                rec.updated_at || rec.created_at,
                            ).getTime(),
                        };
                    });
                }
            } catch {
                /* swallow */
            }
        };
        void probe();
        const id = setInterval(probe, 90_000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    // Wall-clock tick for the recovered-from-DB case only. The singleton
    // pushes elapsed updates on its own; we just need this for the rare
    // case where a stale 'recording' lecture exists in the DB but no
    // singleton session is live.
    useEffect(() => {
        if (!activeRecLecture) return;
        if (recordingSessionService.getState().status !== 'idle') return;
        const tick = () => {
            setRecElapsedSec(
                Math.max(
                    0,
                    Math.floor(
                        (Date.now() - activeRecLecture.startedAtMs) / 1000,
                    ),
                ),
            );
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [activeRecLecture]);

    // Compute "L#" — 1-based index of the active recording within its
    // course's lecture list (sorted by created_at ASC). Re-loads when
    // the active recording changes; null while loading or unresolvable.
    const [activeRecLectureNumber, setActiveRecLectureNumber] = useState<number | null>(null);
    useEffect(() => {
        if (!activeRecLecture) {
            setActiveRecLectureNumber(null);
            return;
        }
        let cancelled = false;
        storageService
            .listLecturesByCourse(activeRecLecture.courseId)
            .then((list) => {
                if (cancelled) return;
                const sorted = [...list].sort(
                    (a, b) =>
                        new Date(a.created_at).getTime() -
                        new Date(b.created_at).getTime(),
                );
                const idx = sorted.findIndex(
                    (l) => l.id === activeRecLecture.lectureId,
                );
                setActiveRecLectureNumber(idx >= 0 ? idx + 1 : null);
            })
            .catch(() => {
                if (!cancelled) setActiveRecLectureNumber(null);
            });
        return () => {
            cancelled = true;
        };
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

    /**
     * Funnel for creating a new lecture row + navigating to its review
     * page. The actual recording start happens later on the recording
     * page itself; this function only:
     *   1. (S1.7 / W10) Gates against concurrent recording — if the
     *      singleton is already in `recording` / `paused`, ask the user
     *      whether to end the live session before opening a new one.
     *   2. Same-day dedup — if this course already has a lecture dated
     *      today, offer to open it instead of creating a duplicate.
     *   3. (S1.8 / N1) Threads `opts.scheduledDate` into the new
     *      lecture's `date` field — Inbox passes `nextClass.date`, rail
     *      / chip clicks fall through to "now". The schema column
     *      `started_at_ms` (V12) lands in Sprint 2.
     *
     * All entry points (rail course chip → handleCourseAction, home
     * `onStartNewLecture`, CourseDetailPage `onCreateLecture`, inbox
     * 「下一堂課」row) flow through this single helper, so wiring the
     * confirm gate here is sufficient for W10.
     */
    const startNewLectureFor = useCallback(
        async (
            courseId: string,
            opts?: { scheduledDate?: Date },
        ) => {
            try {
                // ─── S1.7 / W10 — concurrent recording gate ────────────
                const session = recordingSessionService.getState();
                if (
                    session.status === 'recording' ||
                    session.status === 'paused'
                ) {
                    // Compose a friendly label for the live session — try
                    // for the lecture title if we can find it.
                    let liveLabel = '目前錄音';
                    try {
                        if (session.lectureId) {
                            const live = await storageService.getLecture(
                                session.lectureId,
                            );
                            if (live?.title) liveLabel = `「${live.title}」`;
                        }
                    } catch {
                        /* fall back to default label */
                    }
                    const elapsedLabel = fmtElapsed(session.elapsed);
                    const ok = await confirmService.ask({
                        title: '已有錄音中',
                        message:
                            `${liveLabel}目前正在錄音 (${elapsedLabel})。\n\n` +
                            '要結束目前錄音再開始新課堂嗎？',
                        confirmLabel: '結束並開始新課堂',
                        cancelLabel: '取消',
                        variant: 'danger',
                    });
                    if (!ok) return;
                    try {
                        await recordingSessionService.stop();
                    } catch (err) {
                        toastService.error(
                            '結束舊錄音失敗',
                            err instanceof Error ? err.message : String(err),
                        );
                        return;
                    }
                }

                // Same-day collision check: if the course already has a
                // lecture dated today, ask whether to open it or create a
                // fresh blank one. Avoids the «每按一次「下一堂課」就生
                // 一個空白» pile-up that happens when the user opens the
                // home page repeatedly.
                const existingList = await storageService
                    .listLecturesByCourse(courseId)
                    .catch(
                        () =>
                            [] as Awaited<
                                ReturnType<
                                    typeof storageService.listLecturesByCourse
                                >
                            >,
                    );
                const targetDate = opts?.scheduledDate ?? new Date();
                const targetIso = targetDate.toISOString();
                const targetDayKey = targetIso.slice(0, 10);
                const sameDay = existingList.find((l) => {
                    if (!l.date) return false;
                    return l.date.slice(0, 10) === targetDayKey;
                });
                if (sameDay) {
                    // Yes → open existing, No → create blank.
                    const openExisting = await confirmService.ask({
                        title: '已有一堂課',
                        message: `課堂「${sameDay.title}」(${sameDay.status === 'completed' ? '已完成' : sameDay.status === 'recording' ? '錄音中' : '待錄音'}) 已存在。\n\n要開啟這堂繼續，還是另外新增一堂空白課堂？`,
                        confirmLabel: '開啟現有的',
                        cancelLabel: '新增空白',
                    });
                    if (openExisting) {
                        setSelectedCourseId(courseId);
                        setActiveNav(`review:${courseId}:${sameDay.id}`);
                        return;
                    }
                    // Fall through to create a new blank lecture.
                }

                const id = crypto.randomUUID();
                const now = new Date().toISOString();
                await storageService.saveLecture({
                    id,
                    course_id: courseId,
                    title: '新課堂',
                    // S1.8 — scheduledDate threads through here. Inbox
                    // 「下一堂課」passes nextClass.date so the lecture is
                    // tagged with the Canvas-derived class meeting time;
                    // rail / quick-record falls through to `new Date()`.
                    date: targetIso,
                    duration: 0,
                    status: 'recording',
                    created_at: now,
                    updated_at: now,
                });
                setSelectedCourseId(courseId);
                setActiveNav(`review:${courseId}:${id}`);
            } catch (err) {
                console.error('[H18DeepApp] create lecture failed:', err);
            }
        },
        [],
    );

    // v0.7.x: Listen for declarative nav requests dispatched from places
    // that don't have direct access to setActiveNav — e.g. an actionable
    // toast deep inside a service. Single global listener, fire-and-forget.
    const [profileInitialTab, setProfileInitialTab] = useState<
        | 'overview'
        | 'transcribe'
        | 'translate'
        | 'cloud'
        | 'appearance'
        | 'audio'
        | 'data'
        | 'integrations'
        | 'about'
        | undefined
    >(undefined);

    useEffect(() => {
        const onNavRequest = (e: Event) => {
            const detail = (e as CustomEvent<{
                target: import('../../services/toastService').ToastNavTarget;
            }>).detail;
            const target = detail?.target;
            if (!target) return;
            switch (target.kind) {
                case 'home':
                    setActiveNav('home');
                    break;
                case 'profile':
                    if (target.tab) setProfileInitialTab(target.tab);
                    setActiveNav('profile');
                    break;
                case 'course':
                    setSelectedCourseId(target.courseId);
                    setActiveNav(`course:${target.courseId}`);
                    break;
                case 'course-edit':
                    setSelectedCourseId(target.courseId);
                    setActiveNav(`course-edit:${target.courseId}`);
                    break;
            }
        };
        window.addEventListener('classnote-h18-nav-request', onNavRequest);
        return () =>
            window.removeEventListener(
                'classnote-h18-nav-request',
                onNavRequest,
            );
    }, []);

    const handleCourseAction = useCallback(
        (courseId: string, action: 'edit' | 'quick-record' | 'delete') => {
            if (action === 'edit') {
                setSelectedCourseId(courseId);
                setActiveNav(`course-edit:${courseId}`);
                return;
            }
            if (action === 'quick-record') {
                void startNewLectureFor(courseId);
                return;
            }
            if (action === 'delete') {
                void (async () => {
                    try {
                        await storageService.deleteCourse(courseId);
                        // If we were on a page tied to this course, bounce home
                        const nav = activeNav;
                        if (
                            nav === `course:${courseId}` ||
                            nav === `course-edit:${courseId}` ||
                            nav === `recording:${courseId}` ||
                            nav.startsWith(`review:${courseId}:`)
                        ) {
                            setActiveNav('home');
                        }
                        // Refresh the course list (rail / home / search)
                        window.dispatchEvent(
                            new CustomEvent('classnote-courses-changed'),
                        );
                    } catch (err) {
                        console.error('[H18DeepApp] delete course failed:', err);
                    }
                })();
                return;
            }
        },
        [activeNav, startNewLectureFor],
    );

    // ─── keyboard shortcuts ─────────────────────────────────────────
    // S3a-4: bindings now flow through keymapService — combos are
    // defined in DEFAULT_KEYMAP and user-customisable from PKeyboard.
    // We still gate `inEditor` here (rather than inside the service)
    // because that's a UI policy, not a key-matching concern: ⌘K
    // (search palette) is the one global escape hatch we still honour
    // inside inputs. The legacy `e.key === '/'` shortcut for AI dock
    // was dropped — its only motivation was muscle memory from before
    // ⌘J shipped, and overloading `/` makes it impossible to type a
    // slash without holding Mod.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const tag = target?.tagName;
            const inEditor =
                tag === 'INPUT' ||
                tag === 'TEXTAREA' ||
                tag === 'SELECT' ||
                target?.isContentEditable === true;

            if (!inEditor && keymapService.matchesEvent('toggleTheme', e)) {
                e.preventDefault();
                void toggleTheme();
                return;
            }
            if (keymapService.matchesEvent('search', e)) {
                // search palette is the universal escape hatch —
                // intentionally still fires inside inputs.
                e.preventDefault();
                setOverlayNav('search');
                return;
            }
            if (!inEditor && keymapService.matchesEvent('toggleAiDock', e)) {
                e.preventDefault();
                setAiDockOpen((v) => !v);
                return;
            }
            if (!inEditor && keymapService.matchesEvent('newCourse', e)) {
                e.preventDefault();
                setIsCourseDialogOpen(true);
                return;
            }
            if (!inEditor && keymapService.matchesEvent('goHome', e)) {
                e.preventDefault();
                setActiveNav('home');
                setOverlayNav(null);
                return;
            }
            if (!inEditor && keymapService.matchesEvent('goProfile', e)) {
                e.preventDefault();
                setActiveNav('profile');
                setOverlayNav(null);
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

    // ─── S3b-2 · global contextmenu listener ─────────────────────────
    // Per PLAN §3b (F6): on text inputs we render H18TextContextMenu;
    // on every other surface we **just preventDefault** so the browser's
    // native (Inspect / Save Image / Reload) menu doesn't surface in a
    // shipped desktop app context. Component-level menus (e.g.
    // CourseRailContextMenu, LectureContextMenu) call e.stopPropagation
    // first, so they're unaffected — only the bubbling defaults that
    // reach `document` get suppressed.
    //
    // cp75.9 — restored the "其他 → preventDefault" half that the
    // earlier comment had carved out as a trade-off. The trade-off
    // (let users keep Inspect access) wasn't accepted by the spec; in
    // production builds Inspect is gone anyway, so the cost was zero.
    useEffect(() => {
        const onContextMenu = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            const isInput =
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement;
            const isContentEditable = target.isContentEditable === true;
            if (isInput || isContentEditable) {
                e.preventDefault();
                setTextMenuState({ x: e.clientX, y: e.clientY, target });
                return;
            }
            // F6: every non-text surface — we don't open anything, but
            // the browser's native menu is suppressed. Component-level
            // ctx menus must call e.stopPropagation before bubbling here
            // (they already do; verified for course rail / lecture row).
            e.preventDefault();
        };
        document.addEventListener('contextmenu', onContextMenu);
        return () =>
            document.removeEventListener('contextmenu', onContextMenu);
    }, []);

    const parsed = useMemo(() => parseNav(activeNav), [activeNav]);

    // cp75.30 — remember the last review:cid:lid the user landed on so
    // navigating to /ai afterwards still gives the AI tutor a lecture
    // scope. Hydrated from localStorage once on mount; updated whenever
    // the route enters a review page with both ids resolved.
    const [lastReview, setLastReview] = useState<LastReviewState | undefined>(
        () => loadLastReview(),
    );
    useEffect(() => {
        if (
            parsed.kind === 'review' &&
            parsed.lectureId &&
            parsed.courseId
        ) {
            const next: LastReviewState = {
                lectureId: parsed.lectureId,
                courseId: parsed.courseId,
            };
            setLastReview((prev) =>
                prev?.lectureId === next.lectureId &&
                prev?.courseId === next.courseId
                    ? prev
                    : next,
            );
            storeLastReview(next);
        }
    }, [parsed]);

    // ─── inbox aggregation for TopBar count + Rail per-course badge ──
    // We re-run useAggregatedCanvasInbox here (H18Inbox uses it too —
    // both share the canvasCache so the second hook is essentially free).
    const { items: inboxItems } = useAggregatedCanvasInbox(courses);

    // Re-render whenever any inbox state (snoozed/done) flips.
    const [inboxStateTick, setInboxStateTick] = useState(0);
    useEffect(() => {
        const off = subscribeInboxStates(() => setInboxStateTick((n) => n + 1));
        // Lazy-expire snoozes once a minute.
        const interval = setInterval(() => setInboxStateTick((n) => n + 1), 60_000);
        return () => {
            off();
            clearInterval(interval);
        };
    }, []);

    const { inboxTotal, urgentByCourse } = useMemo(() => {
        const now = Date.now();
        let total = 0;
        const byCourse = new Map<string, number>();
        for (const it of inboxItems) {
            const st = getInboxState(it.id, now);
            if (st.state !== 'pending') continue;
            total += 1;
            if (it.urgent && it.courseId) {
                byCourse.set(
                    it.courseId,
                    (byCourse.get(it.courseId) ?? 0) + 1,
                );
            }
        }
        return { inboxTotal: total, urgentByCourse: byCourse };
        // inboxStateTick intentionally a dep so we recompute on state change
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inboxItems, inboxStateTick]);

    // Read HomeLayout variant from AppSettings.appearance.layout;
    // settings is loaded async, default to 'A' until it arrives.
    const [homeVariant, setHomeVariant] = useState<'A' | 'B' | 'C'>('A');
    useEffect(() => {
        let cancelled = false;
        const sync = async () => {
            try {
                const settings = await storageService.getAppSettings();
                if (cancelled) return;
                const v = settings?.appearance?.layout;
                if (v === 'A' || v === 'B' || v === 'C') setHomeVariant(v);
            } catch {
                /* swallow */
            }
        };
        sync();
        const onChange = () => sync();
        window.addEventListener('classnote-settings-changed', onChange);
        return () => {
            cancelled = true;
            window.removeEventListener('classnote-settings-changed', onChange);
        };
    }, []);

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
                        variant={homeVariant}
                        onPickCourse={(id) => setSelectedCourseId(id)}
                        onOpenCourse={(id) => setActiveNav(`course:${id}`)}
                        onOpenLecture={(courseId, lectureId) =>
                            setActiveNav(`review:${courseId}:${lectureId}`)
                        }
                        onStartNewLecture={(courseId, opts) =>
                            void startNewLectureFor(courseId, opts)
                        }
                    />
                );
            case 'notes':
                return <NotesEditorComingSoon onBack={() => setActiveNav('home')} />;
            case 'ai':
                return (
                    <H18AIPage
                        onBack={() => setActiveNav('home')}
                        aiContext={deriveAIContextForPage(parsed, lastReview)}
                    />
                );
            case 'profile':
                return (
                    <ProfilePage
                        onBack={() => {
                            setProfileInitialTab(undefined);
                            setActiveNav('home');
                        }}
                        initialTab={profileInitialTab}
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
                        onEditCourse={() =>
                            setActiveNav(`course-edit:${parsed.courseId}`)
                        }
                        onCreateLecture={() => void startNewLectureFor(parsed.courseId)}
                    />
                );
            case 'course-edit':
                return (
                    <CourseEditPage
                        courseId={parsed.courseId}
                        onBack={() => setActiveNav(`course:${parsed.courseId}`)}
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

    // True when we're currently displaying H18RecordingPage (review:cid:lid
    // where lecture status='recording'). Hide the floating AI fab here so it
    // doesn't overlap the transport bar's 「結束 · 儲存」red button.
    const isOnRecordingPage =
        parsed.kind === 'review' &&
        activeRecLecture != null &&
        parsed.lectureId === activeRecLecture.lectureId;

    // Build active recording payload for TopBar island.
    // 當使用者已經在錄音頁就不要再顯示 TopBar 的 island — 否則畫面會
    // 同時看到上方膠囊跟下方 transport bar 兩個 elapsed 計時器。
    const activeRecCourse = activeRecLecture
        ? courses.find((c) => c.id === activeRecLecture.courseId)
        : null;
    const activeRecording = activeRecLecture && activeRecCourse && !isOnRecordingPage
        ? {
              courseShort: courseShort(
                  activeRecCourse.title,
                  activeRecCourse.keywords,
              ),
              courseColor: courseColor(activeRecCourse.id),
              lectureNumber: activeRecLectureNumber ?? '—',
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
                effectiveTheme={theme}
                onToggleTheme={() => void toggleTheme()}
                inboxCount={inboxTotal}
                onOpenInbox={() => setActiveNav('home')}
                activeRecording={activeRecording}
            />
            <div className={s.layout}>
                <H18Rail
                    activeNav={activeNav}
                    onNav={handleNav}
                    courses={courses}
                    virtualCourses={virtualCourses}
                    onPickVirtualCourse={(canvasCourseId, fullTitle) => {
                        setAddCoursePrefill({ title: fullTitle, canvasCourseId });
                        setIsCourseDialogOpen(true);
                    }}
                    avatarInitial="U"
                    onCourseAction={handleCourseAction}
                    urgentByCourseId={urgentByCourse}
                />
                <main className={s.main}>{renderMain()}</main>
            </div>

            {/* Draggable AI fab — drag to reposition + snap to nearest edge,
                position persisted to localStorage. */}
            {parsed.kind !== 'ai' && !aiDockOpen && (
                <DraggableAIFab
                    onClick={() => setAiDockOpen(true)}
                    recording={isOnRecordingPage}
                />
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
                aiContext={
                    parsed.kind === 'review'
                        ? {
                              kind: 'lecture',
                              lectureId: parsed.lectureId,
                              courseId: parsed.courseId,
                              label:
                                  courses.find((c) => c.id === parsed.courseId)
                                      ?.title || undefined,
                          }
                        : parsed.kind === 'course' ||
                            parsed.kind === 'course-edit'
                          ? {
                                kind: 'course',
                                courseId: parsed.courseId,
                                label:
                                    courses.find(
                                        (c) => c.id === parsed.courseId,
                                    )?.title || undefined,
                            }
                          : { kind: 'global' }
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

            {/* S3b-2 · text right-click menu (input / textarea / contenteditable) */}
            {textMenuState && (
                <H18TextContextMenu
                    x={textMenuState.x}
                    y={textMenuState.y}
                    target={textMenuState.target}
                    onClose={() => setTextMenuState(null)}
                />
            )}

            {/* 新增課程 dialog — H18 重寫版 (P6.3) */}
            <AddCourseDialog
                isOpen={isCourseDialogOpen}
                onClose={() => {
                    setIsCourseDialogOpen(false);
                    setAddCoursePrefill(undefined);
                }}
                prefill={addCoursePrefill}
                onSubmit={async (title, keywords, pdfData, description, canvasCourseId, agentResult) => {
                    if (!title.trim()) return;
                    try {
                        const newCourseId = crypto.randomUUID();
                        const now = new Date().toISOString();
                        if (agentResult) {
                            // URL agent path: syllabus 已經 AI 整理過，直接落地，
                            // 別再走 saveCourseWithSyllabus (會再跑一次 extractSyllabus)。
                            // 把 sourceText 塞進 _classnote_raw_description 給未來
                            // 「⟳ 重新生成」用，狀態標 'ready' 走完整 metadata。
                            const stampedSyllabus = {
                                ...agentResult.syllabus,
                                _classnote_status: 'ready',
                                _classnote_source: 'description',
                                _classnote_updated_at: now,
                                _classnote_raw_description: agentResult.sourceText,
                            } as unknown as typeof agentResult.syllabus;
                            await storageService.saveCourse({
                                id: newCourseId,
                                user_id: '',
                                title,
                                description: '',
                                keywords,
                                syllabus_info: stampedSyllabus,
                                canvas_course_id: canvasCourseId,
                                created_at: now,
                                updated_at: now,
                            });
                        } else {
                            await storageService.saveCourseWithSyllabus(
                                {
                                    id: newCourseId,
                                    user_id: '',
                                    title,
                                    description: description || '',
                                    keywords,
                                    syllabus_info: undefined,
                                    canvas_course_id: canvasCourseId,
                                    created_at: now,
                                    updated_at: now,
                                },
                                { pdfData, triggerSyllabusGeneration: true },
                            );
                        }
                        setIsCourseDialogOpen(false);
                        setAddCoursePrefill(undefined);
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
