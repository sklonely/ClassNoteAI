/**
 * canvasFeedService · v0.7.x
 *
 * 抓取 + 解析 Canvas LMS 的兩條 feed：
 *   1. Announcements feed — Atom XML, **per-course**
 *      `https://canvas.{tenant}/feeds/announcements/enrollment_xxx.atom`
 *   2. Calendar feed — iCalendar (.ics), **per-user 全域**
 *      `https://canvas.{tenant}/feeds/calendars/user_xxx.ics`
 *
 * 不裝 RSS / iCal 套件。Atom 用 regex（Canvas 的 Atom 結構很穩定）；
 * iCal 用 RFC 5545 line unfolding + key:value parser，純 string ops。
 *
 * Fetch 走 @tauri-apps/plugin-http 避開 webview CORS。
 *
 * 不在這支做：
 *  - cache（看 canvasCacheService）
 *  - course 配對（看 PairingWizard / canvas_course_id 欄位）
 */

import { fetch } from '@tauri-apps/plugin-http';

/* ════════════════════ types ════════════════════ */

export interface CanvasAnnouncement {
    /** Canvas tag URI — dedupe / 已讀 tracking 用 */
    id: string;
    /** "HW4 must be quicksort-based"（已剝除 "Announcement: " 前綴） */
    title: string;
    /** "Announcement: HW4..."（原樣保留） */
    rawTitle: string;
    /** "Liang Huang" / "Bowen Xie" — 老師或 TA 姓名 */
    author: string;
    /** ISO 8601 with timezone */
    publishedAt: string;
    updatedAt: string;
    /** 連回 Canvas discussion topic */
    link: string;
    /** 原始 HTML（已 decode entities）— 給 rich render 用 */
    contentHtml: string;
    /** 純文字摘要（HTML stripped + entities decoded + collapsed whitespace） */
    contentText: string;
}

export interface CanvasAnnouncementsFeed {
    /** "ALGORITHMS (CS_514_001_S2026) Announcements Feed" */
    feedTitle: string;
    /** "ALGORITHMS (CS_514_001_S2026)"（剝掉 " Announcements Feed" 後綴） */
    courseFullTitle: string;
    /** "2042483"（從 feed `<id>` URL `/courses/{id}/announcements` 抽出） */
    canvasCourseId: string;
    feedLink: string;
    /** Feed 級別的 updated 時間 */
    feedUpdatedAt: string;
    announcements: CanvasAnnouncement[];
}

export type CanvasEventType = 'assignment' | 'quiz' | 'calendar_event' | 'other';

export interface CanvasCalendarEvent {
    /** "event-assignment-10461765" */
    uid: string;
    /** 'assignment' | 'quiz' | 'calendar_event' | 'other'（從 UID 前綴判斷） */
    type: CanvasEventType;
    /** "10461765"（從 UID 抽出 Canvas 內部 ID） */
    internalId: string;
    /** "Critique on 04/27"（已剝除尾巴 [course code]） */
    title: string;
    /** 完整 SUMMARY 含 [course code] */
    rawTitle: string;
    /** "ST/TRUSTWORTHY MACH. LEARNING (AI_539_X007_S2026)" 或 null */
    courseFullTitle: string | null;
    /** "2055885"（從 URL `include_contexts=course_2055885` 抽出）或 null */
    canvasCourseId: string | null;
    /** ISO 8601 (UTC datetime) 或 ISO date-only (`2026-04-05`) */
    startAt: string;
    /** ISO 8601 / date-only / null */
    endAt: string | null;
    /** true 時 startAt / endAt 是 date-only（無時分） */
    isAllDay: boolean;
    /** 純文字描述（plain DESCRIPTION 欄；可能空字串） */
    description: string;
    /** HTML 版（X-ALT-DESC）；可能 null */
    descriptionHtml: string | null;
    /** 連回 Canvas */
    url: string;
}

export interface CanvasCalendarFeed {
    /** "Che-Yu Chan Calendar (Canvas)" — 從 X-WR-CALNAME 抽 */
    calendarName: string | null;
    events: CanvasCalendarEvent[];
    /**
     * 衍生：calendar 中出現過的所有 Canvas 課程 (course_id + fullTitle)。
     * Pairing wizard 直接吃這個 list 給使用者配對。
     */
    courses: { canvasCourseId: string; fullTitle: string }[];
}

/* ════════════════════ HTML / entity helpers ════════════════════ */

const ENTITIES: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
};

function decodeEntities(s: string): string {
    return s
        .replace(/&(?:lt|gt|amp|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
        // numeric entities (decimal): &#1234;
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
        // hex: &#x1F4A9;
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function stripHtmlToText(html: string): string {
    // Canvas content is doubly encoded: outer <content type="html"> wraps
    // the entity-encoded HTML. We decode entities, strip tags, then collapse
    // whitespace.
    return decodeEntities(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/* ════════════════════ Atom (Announcements) ════════════════════ */

function pickAtomTag(block: string, tag: string): string | null {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`);
    const m = block.match(re);
    return m ? m[1].trim() : null;
}

function pickAtomLinkHref(block: string): string | null {
    // <link href="..." rel="..."/>
    const m = block.match(/<link\b[^>]*\bhref="([^"]*)"/);
    return m ? m[1] : null;
}

export function parseAnnouncementsAtom(xml: string): CanvasAnnouncementsFeed {
    // Feed-level: pull just the metadata BEFORE the first <entry>
    const firstEntryIdx = xml.indexOf('<entry>');
    const head = firstEntryIdx >= 0 ? xml.slice(0, firstEntryIdx) : xml;

    const feedTitle = pickAtomTag(head, 'title') ?? '';
    const feedId = pickAtomTag(head, 'id') ?? '';
    const feedUpdatedAt = pickAtomTag(head, 'updated') ?? '';
    const feedLink = pickAtomLinkHref(head) ?? '';
    const courseIdMatch = feedId.match(/courses\/(\d+)/);
    const canvasCourseId = courseIdMatch ? courseIdMatch[1] : '';

    const courseFullTitle = feedTitle.replace(/\s+Announcements\s+Feed\s*$/i, '');

    // Per-entry
    const entries: CanvasAnnouncement[] = [];
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(xml))) {
        const block = m[1];
        const rawTitle = pickAtomTag(block, 'title') ?? '';
        const title = rawTitle.replace(/^Announcement:\s*/, '');
        const author = pickAtomTag(block, 'name') ?? '';
        const publishedAt = pickAtomTag(block, 'published') ?? '';
        const updatedAt = pickAtomTag(block, 'updated') ?? publishedAt;
        const id = pickAtomTag(block, 'id') ?? '';
        const link = pickAtomLinkHref(block) ?? '';
        const contentEncoded = pickAtomTag(block, 'content') ?? '';
        // content is entity-encoded HTML; first decode to get real HTML, then keep it
        const contentHtml = decodeEntities(contentEncoded);
        const contentText = stripHtmlToText(contentEncoded);

        entries.push({
            id,
            title,
            rawTitle,
            author,
            publishedAt,
            updatedAt,
            link,
            contentHtml,
            contentText,
        });
    }

    return {
        feedTitle,
        courseFullTitle,
        canvasCourseId,
        feedLink,
        feedUpdatedAt,
        announcements: entries,
    };
}

/* ════════════════════ iCalendar (Calendar) ════════════════════ */

interface IcsLine {
    /** "DTSTART" or "DTSTART;VALUE=DATE;VALUE=DATE" or "X-ALT-DESC;FMTTYPE=text/html" */
    rawKey: string;
    /** "DTSTART" — bare key without params */
    key: string;
    params: Record<string, string>;
    value: string;
}

function unfoldIcs(text: string): string {
    // RFC 5545: continuation lines start with space or tab
    return text.replace(/\r?\n[ \t]/g, '');
}

function parseIcsLine(line: string): IcsLine | null {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) return null;
    const lhs = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const parts = lhs.split(';');
    const key = parts[0];
    const params: Record<string, string> = {};
    for (const p of parts.slice(1)) {
        const eq = p.indexOf('=');
        if (eq > 0) params[p.slice(0, eq)] = p.slice(eq + 1);
    }
    return { rawKey: lhs, key, params, value };
}

/**
 * "20260330T170000Z" → ISO 8601 "2026-03-30T17:00:00Z"
 * "20260405"          → "2026-04-05" (date-only)
 */
function parseIcsDate(value: string): { iso: string; isAllDay: boolean } | null {
    if (/^\d{8}T\d{6}Z$/.test(value)) {
        const y = value.slice(0, 4);
        const mo = value.slice(4, 6);
        const da = value.slice(6, 8);
        const hh = value.slice(9, 11);
        const mi = value.slice(11, 13);
        const ss = value.slice(13, 15);
        return { iso: `${y}-${mo}-${da}T${hh}:${mi}:${ss}Z`, isAllDay: false };
    }
    if (/^\d{8}$/.test(value)) {
        const y = value.slice(0, 4);
        const mo = value.slice(4, 6);
        const da = value.slice(6, 8);
        return { iso: `${y}-${mo}-${da}`, isAllDay: true };
    }
    // Floating local time without TZ: "20260330T170000"
    if (/^\d{8}T\d{6}$/.test(value)) {
        const y = value.slice(0, 4);
        const mo = value.slice(4, 6);
        const da = value.slice(6, 8);
        const hh = value.slice(9, 11);
        const mi = value.slice(11, 13);
        const ss = value.slice(13, 15);
        // Treat as UTC to be consistent (Canvas typically emits Z suffix anyway)
        return { iso: `${y}-${mo}-${da}T${hh}:${mi}:${ss}Z`, isAllDay: false };
    }
    return null;
}

function decodeIcsText(value: string): string {
    // RFC 5545 escape: \\ \, \n \N
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

function uidToType(uid: string): { type: CanvasEventType; internalId: string } {
    const m = uid.match(/^event-([a-z_]+)-(.+)$/i);
    if (!m) return { type: 'other', internalId: uid };
    const prefix = m[1].toLowerCase();
    const internalId = m[2];
    if (prefix === 'assignment') return { type: 'assignment', internalId };
    if (prefix === 'quiz') return { type: 'quiz', internalId };
    if (prefix === 'calendar_event') return { type: 'calendar_event', internalId };
    return { type: 'other', internalId };
}

export function parseCalendarIcs(text: string): CanvasCalendarFeed {
    const unfolded = unfoldIcs(text);
    const lines = unfolded.split(/\r?\n/);

    let calendarName: string | null = null;
    const events: CanvasCalendarEvent[] = [];
    let inEvent = false;
    let buf: IcsLine[] = [];

    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') {
            inEvent = true;
            buf = [];
            continue;
        }
        if (line === 'END:VEVENT') {
            inEvent = false;
            const ev = buildEvent(buf);
            if (ev) events.push(ev);
            buf = [];
            continue;
        }
        if (inEvent) {
            const parsed = parseIcsLine(line);
            if (parsed) buf.push(parsed);
            continue;
        }
        // Top-level (VCALENDAR header)
        if (line.startsWith('X-WR-CALNAME:')) {
            calendarName = line.slice('X-WR-CALNAME:'.length).trim();
        }
    }

    // Derive unique courses from events
    const courseMap = new Map<string, string>();
    for (const ev of events) {
        if (ev.canvasCourseId && ev.courseFullTitle && !courseMap.has(ev.canvasCourseId)) {
            courseMap.set(ev.canvasCourseId, ev.courseFullTitle);
        }
    }
    const courses = Array.from(courseMap, ([canvasCourseId, fullTitle]) => ({
        canvasCourseId,
        fullTitle,
    }));

    return { calendarName, events, courses };
}

function buildEvent(buf: IcsLine[]): CanvasCalendarEvent | null {
    let uid = '';
    let summary = '';
    let url = '';
    let description = '';
    let descriptionHtml: string | null = null;
    let dtstart: { iso: string; isAllDay: boolean } | null = null;
    let dtend: { iso: string; isAllDay: boolean } | null = null;

    for (const l of buf) {
        switch (l.key) {
            case 'UID':
                uid = l.value;
                break;
            case 'SUMMARY':
                summary = decodeIcsText(l.value);
                break;
            case 'URL':
                url = l.value;
                break;
            case 'DESCRIPTION':
                description = decodeIcsText(l.value);
                break;
            case 'X-ALT-DESC':
                descriptionHtml = decodeIcsText(l.value);
                break;
            case 'DTSTART':
                dtstart = parseIcsDate(l.value);
                break;
            case 'DTEND':
                dtend = parseIcsDate(l.value);
                break;
        }
    }

    if (!uid || !dtstart) return null;

    const { type, internalId } = uidToType(uid);

    // Course tag from SUMMARY trailing brackets (last [...])
    const bracketMatch = summary.match(/\[([^\[\]]+)\]\s*$/);
    const courseFullTitle = bracketMatch ? bracketMatch[1].trim() : null;
    const title = bracketMatch
        ? summary.slice(0, bracketMatch.index).trim()
        : summary.trim();

    // canvas course id from URL
    const ctxMatch = url.match(/include_contexts=course_(\d+)/);
    const canvasCourseId = ctxMatch ? ctxMatch[1] : null;

    return {
        uid,
        type,
        internalId,
        title,
        rawTitle: summary,
        courseFullTitle,
        canvasCourseId,
        startAt: dtstart.iso,
        endAt: dtend?.iso ?? null,
        isAllDay: dtstart.isAllDay,
        description,
        descriptionHtml,
        url,
    };
}

/* ════════════════════ fetch wrappers ════════════════════ */

async function fetchText(url: string): Promise<string> {
    const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/atom+xml, text/calendar, */*' },
    });
    if (!res.ok) {
        throw new Error(
            `Canvas feed HTTP ${res.status} ${res.statusText}: ${url}`,
        );
    }
    return await res.text();
}

export async function fetchAnnouncementsFeed(
    url: string,
): Promise<CanvasAnnouncementsFeed> {
    const text = await fetchText(url);
    return parseAnnouncementsAtom(text);
}

export async function fetchCalendarFeed(
    url: string,
): Promise<CanvasCalendarFeed> {
    const text = await fetchText(url);
    return parseCalendarIcs(text);
}
