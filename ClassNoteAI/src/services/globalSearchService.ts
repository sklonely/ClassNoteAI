/**
 * Global ⌘K search index — courses + lectures + actions.
 *
 * 對應 docs/design/h18-deep/h18-nav-pages.jsx SearchOverlay (L27+) 的
 * allItems 邏輯，但用真實 storageService 資料填，不是 V3_COURSES mock。
 *
 * Reminder / Concept 類別暫時不索引（reminders 沒 schema、concept
 * extraction 沒做） — 留白。
 *
 * Index 在第一次 `search()` 時懶建構，之後監聽
 * `classnote-courses-changed` 事件重建。
 */

import MiniSearch from 'minisearch';
import type { SearchResult } from 'minisearch';
import { storageService } from './storageService';

export type SearchItemKind = 'COURSE' | 'NOTE' | 'ACTION';

export interface SearchItem {
    /** Unique id used by minisearch */
    id: string;
    kind: SearchItemKind;
    /** Display group label */
    group: string;
    /** Display label (line 1) */
    label: string;
    /** Display sub-label (line 2) */
    sub: string;
    /** Optional keyboard shortcut to render */
    shortcut?: string;
    /** Indexed text (combined) */
    indexText: string;
    /** courseId if this is a course or course-scoped note */
    courseId?: string;
    /** lectureId for note kind */
    lectureId?: string;
    /** Action id for kind=ACTION */
    action?:
        | 'home'
        | 'add-course'
        | 'open-ai'
        | 'open-settings'
        | 'start-recording';
}

class GlobalSearchService {
    private mini = new MiniSearch<SearchItem>({
        idField: 'id',
        fields: ['indexText', 'label', 'sub'],
        storeFields: [
            'kind',
            'group',
            'label',
            'sub',
            'shortcut',
            'courseId',
            'lectureId',
            'action',
        ],
        searchOptions: {
            prefix: true,
            fuzzy: 0.18,
            boost: { label: 2, indexText: 1, sub: 0.8 },
        },
    });

    private items: SearchItem[] = [];
    private built = false;
    private buildingPromise: Promise<void> | null = null;

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('classnote-courses-changed', () => {
                this.invalidate();
            });
        }
    }

    invalidate() {
        this.built = false;
        this.buildingPromise = null;
    }

    private async build(): Promise<void> {
        if (this.built) return;
        if (this.buildingPromise) return this.buildingPromise;

        this.buildingPromise = (async () => {
            try {
                const [allCourses, allLectures] = await Promise.all([
                    storageService.listCourses().catch(() => []),
                    storageService.listLectures().catch(() => []),
                ]);

                // cp75.23 — Finding 8.1: filter out soft-deleted courses
                // before indexing, and propagate the filter to lectures so
                // children of trashed courses don't leak into ⌘K. Backend
                // already filters lecture-level `is_deleted=true`, but the
                // parent-course check is purely client-side.
                const courses = allCourses.filter((c) => !c.is_deleted);
                const liveCourseIds = new Set(courses.map((c) => c.id));
                const lectures = allLectures.filter(
                    (lec) => !lec.is_deleted && liveCourseIds.has(lec.course_id),
                );

                const items: SearchItem[] = [];

                // Courses
                for (const c of courses) {
                    items.push({
                        id: `course:${c.id}`,
                        kind: 'COURSE',
                        group: '課程',
                        label: c.title,
                        sub: [
                            c.syllabus_info?.instructor,
                            c.syllabus_info?.time,
                            c.keywords ? `關鍵字：${c.keywords}` : null,
                        ]
                            .filter(Boolean)
                            .join(' · ') || '本機課程',
                        indexText: [
                            c.title,
                            c.description,
                            c.keywords,
                            c.syllabus_info?.instructor,
                            c.syllabus_info?.location,
                            (c.syllabus_info?.schedule || []).join(' '),
                        ]
                            .filter(Boolean)
                            .join(' '),
                        courseId: c.id,
                    });
                }

                // Lectures (notes)
                const courseById = new Map(courses.map((c) => [c.id, c]));
                for (const lec of lectures) {
                    const c = courseById.get(lec.course_id);
                    if (!c) continue; // orphan
                    items.push({
                        id: `lec:${lec.id}`,
                        kind: 'NOTE',
                        group: '課堂',
                        label: lec.title,
                        sub: [
                            c.title,
                            lec.duration > 0 ? `${Math.round(lec.duration / 60)}m` : null,
                            shortDate(lec.date),
                        ]
                            .filter(Boolean)
                            .join(' · '),
                        indexText: [
                            lec.title,
                            lec.keywords,
                            c.title,
                            c.keywords,
                        ]
                            .filter(Boolean)
                            .join(' '),
                        courseId: lec.course_id,
                        lectureId: lec.id,
                    });
                }

                // Static actions
                items.push(
                    {
                        id: 'action:home',
                        kind: 'ACTION',
                        group: '動作',
                        label: '回到首頁',
                        sub: '今日 / 行事曆 / Inbox',
                        shortcut: '⌘H',
                        indexText: 'home 首頁 home',
                        action: 'home',
                    },
                    {
                        id: 'action:add-course',
                        kind: 'ACTION',
                        group: '動作',
                        label: '新增課程',
                        sub: '從 PDF 大綱、貼文字、URL 啟動 AI',
                        shortcut: '⌘N',
                        indexText: '新增 課程 add course new',
                        action: 'add-course',
                    },
                    {
                        id: 'action:open-ai',
                        kind: 'ACTION',
                        group: '動作',
                        label: '開啟 AI 助教',
                        sub: '全螢幕對話',
                        shortcut: '⌘J',
                        indexText: 'ai 助教 assistant',
                        action: 'open-ai',
                    },
                    {
                        id: 'action:open-settings',
                        kind: 'ACTION',
                        group: '動作',
                        label: '設定',
                        sub: '個人 / 轉錄 / 翻譯 / 雲端 / 介面 / 音訊 / 資料',
                        shortcut: '⌘,',
                        indexText: '設定 settings profile',
                        action: 'open-settings',
                    },
                );

                this.items = items;
                this.mini.removeAll();
                this.mini.addAll(items);
                this.built = true;
            } catch (err) {
                console.error('[globalSearchService] build failed:', err);
                this.built = true; // avoid hot loop
            } finally {
                this.buildingPromise = null;
            }
        })();

        return this.buildingPromise;
    }

    /** Returns initial picks for empty query — recent lectures + actions. */
    async empty(): Promise<SearchItem[]> {
        await this.build();
        const lectures = this.items.filter((i) => i.kind === 'NOTE').slice(0, 6);
        const actions = this.items.filter((i) => i.kind === 'ACTION');
        return [...lectures, ...actions];
    }

    async search(query: string): Promise<SearchItem[]> {
        await this.build();
        const q = query.trim();
        if (!q) return this.empty();

        const hits: (SearchResult & SearchItem)[] = this.mini.search(q) as (
            SearchResult & SearchItem
        )[];
        return hits.slice(0, 24).map((h) => ({
            id: h.id,
            kind: h.kind,
            group: h.group,
            label: h.label,
            sub: h.sub,
            shortcut: h.shortcut,
            indexText: '',
            courseId: h.courseId,
            lectureId: h.lectureId,
            action: h.action,
        }));
    }
}

function shortDate(iso?: string): string {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    } catch {
        return '';
    }
}

export const globalSearchService = new GlobalSearchService();
