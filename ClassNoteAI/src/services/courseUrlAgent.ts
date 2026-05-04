/**
 * courseUrlAgent · v0.7.x Phase 1
 *
 * 給定一個課程網址 → 抓 root → 偵測登入牆 → 文字抽取 → 找相關連結
 * → 抓子頁 → 累積純文字 → 餵 AI extractSyllabus → 回傳結構化 syllabus
 * + 原始文字 (給 _classnote_raw_description 用)。
 *
 * 限制（MVP，per architecture discussion）：
 *  - 只抓靜態 HTML / 直連 PDF（PDF 暫未實作；下個 milestone）
 *  - 同 origin 同層 / 下層 only — 不爬整個網站
 *  - 偵測登入牆就 bail（Canvas / Moodle / Blackboard 走 RSS 路徑）
 *  - JS 渲染頁面 不支援（root stripped 內容過短就 fail）
 *
 * 進度透過 async generator yield 出去；UI 即時 render 每一步。
 */

import { fetch } from '@tauri-apps/plugin-http';
import { extractSyllabus, type SyllabusInfo } from './llm';

/* ════════════════════ types ════════════════════ */

export type AgentStep =
    | 'fetch-root'
    | 'detect-login'
    | 'discover'
    | 'fetch-page'
    | 'extract'
    | 'analyze'
    | 'done';

export interface AgentProgress {
    step: AgentStep;
    message: string;
    detail?: string;
    /** 抓子頁時的進度索引（從 1 算）。 */
    current?: number;
    total?: number;
}

export interface AgentResult {
    /** AI 推得 / root <title> 推得的課程名（可被 user 覆寫）。 */
    title: string;
    /** 結構化 syllabus（餵給 Course.syllabus_info）。 */
    syllabus: SyllabusInfo;
    /** 抓回來、stripped 後的純文字（concat）— 寫進 _classnote_raw_description 給未來重新生成用。 */
    sourceText: string;
    /** 實際 fetch 過的 URL list（顯示給使用者 + debug）。 */
    sourceUrls: string[];
    /** Root 的 final URL（follow redirects 之後）。 */
    rootUrl: string;
}

export type AgentErrorKind =
    | 'login-required'
    | 'fetch-failed'
    | 'not-html'
    | 'no-content'
    | 'ai-failed'
    | 'aborted'
    | 'invalid-url';

export class AgentError extends Error {
    constructor(
        public readonly kind: AgentErrorKind,
        message: string,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'AgentError';
    }
}

export interface ProcessOptions {
    signal?: AbortSignal;
    /** 使用者已經輸入的課程名提示（給 AI 當 fallback title）。 */
    courseTitleHint?: string;
    /** 候選頁上限。 */
    maxCandidates?: number;
    /** Root stripped text 大於此值就跳過 link discovery。 */
    selfContainedThreshold?: number;
}

/* ════════════════════ public entry ════════════════════ */

const DEFAULT_MAX_CANDIDATES = 4;
const DEFAULT_SELF_CONTAINED_THRESHOLD = 8000;
const PER_PAGE_TEXT_CAP = 50_000;
const COMBINED_TEXT_CAP = 150_000;
const FETCH_TIMEOUT_MS = 30_000;

export async function* processCourseUrl(
    url: string,
    opts: ProcessOptions = {},
): AsyncGenerator<AgentProgress, AgentResult, void> {
    const {
        signal,
        courseTitleHint,
        maxCandidates = DEFAULT_MAX_CANDIDATES,
        selfContainedThreshold = DEFAULT_SELF_CONTAINED_THRESHOLD,
    } = opts;

    // ─── input validation ──────────────────────────────────────
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url.trim());
    } catch {
        throw new AgentError('invalid-url', '網址格式不正確。');
    }
    if (!/^https?:$/i.test(parsedUrl.protocol)) {
        throw new AgentError('invalid-url', '只支援 http / https 網址。');
    }

    // ─── Phase 1: fetch root ───────────────────────────────────
    yield {
        step: 'fetch-root',
        message: '正在讀取主頁',
        detail: parsedUrl.host + parsedUrl.pathname,
    };
    if (signal?.aborted) throw new AgentError('aborted', '已取消。');
    const root = await fetchPage(parsedUrl.href, signal);

    // ─── Phase 2: detect login wall ────────────────────────────
    yield { step: 'detect-login', message: '檢查是否需要登入' };
    const wall = detectLoginWall(root);
    if (wall.blocked) {
        throw new AgentError(
            'login-required',
            wall.reason +
                ' Canvas / Moodle 等需要登入的 LMS 請改用 RSS feed（個人頁 → 整合）。',
        );
    }

    // ─── Phase 3: extract root text ────────────────────────────
    const rootExtracted = extractText(root.html);
    if (rootExtracted.text.length < 200) {
        throw new AgentError(
            'no-content',
            '主頁內容太短或主要為 JavaScript 動態載入，目前無法處理。',
        );
    }

    const blobs: { url: string; text: string }[] = [
        { url: root.finalUrl, text: rootExtracted.text },
    ];
    const sourceUrls: string[] = [root.finalUrl];

    // ─── Phase 4: link discovery (adaptive) ────────────────────
    let candidates: { href: string; text: string; score: number }[] = [];
    if (rootExtracted.text.length < selfContainedThreshold) {
        yield { step: 'discover', message: '尋找相關連結' };
        candidates = discoverCandidates(root.html, root.finalUrl)
            .filter((c) => c.score > 0)
            .slice(0, maxCandidates);
        yield {
            step: 'discover',
            message: candidates.length > 0
                ? `找到 ${candidates.length} 個相關頁`
                : '沒有額外的相關頁，直接分析',
            detail: candidates.map((c) => c.text).join(' · '),
        };
    } else {
        yield {
            step: 'discover',
            message: '主頁內容已足夠，不需要進一步探索',
            detail: `${(rootExtracted.text.length / 1024).toFixed(1)} KB`,
        };
    }

    // ─── Phase 5: fetch each candidate ─────────────────────────
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (signal?.aborted) throw new AgentError('aborted', '已取消。');
        yield {
            step: 'fetch-page',
            message: '讀取相關頁',
            detail: c.text,
            current: i + 1,
            total: candidates.length,
        };
        try {
            const p = await fetchPage(c.href, signal);
            const t = extractText(p.html);
            if (t.text.length > 200) {
                blobs.push({ url: p.finalUrl, text: t.text });
                sourceUrls.push(p.finalUrl);
            }
        } catch (err) {
            // Soft fail — continue with what we have so far
            console.warn('[courseUrlAgent] sub-page fetch failed:', c.href, err);
        }
    }

    // ─── Phase 6: build prompt ────────────────────────────────
    yield { step: 'extract', message: '整合純文字' };
    const combinedRaw = blobs
        .map((b) => `# 來源: ${b.url}\n\n${b.text}`)
        .join('\n\n---\n\n');
    const combined =
        combinedRaw.length > COMBINED_TEXT_CAP
            ? combinedRaw.slice(0, COMBINED_TEXT_CAP) + '\n\n…[truncated]'
            : combinedRaw;
    if (combined.length < 200) {
        throw new AgentError('no-content', '抓不到可用內容。');
    }

    // ─── Phase 7: AI extraction ───────────────────────────────
    if (signal?.aborted) throw new AgentError('aborted', '已取消。');
    yield {
        step: 'analyze',
        message: 'AI 整理課程資訊',
        detail: `${(combined.length / 1024).toFixed(1)} KB → 結構化欄位`,
    };
    const fallbackTitle =
        courseTitleHint?.trim() || rootExtracted.title || '新課程';
    let syllabus: SyllabusInfo;
    try {
        syllabus = await extractSyllabus(fallbackTitle, combined);
    } catch (err) {
        throw new AgentError(
            'ai-failed',
            (err as Error)?.message || 'AI 整理失敗',
            err,
        );
    }

    // Title preference: AI's topic > root <title> > user hint
    const finalTitle =
        syllabus.topic?.trim() ||
        rootExtracted.title ||
        courseTitleHint?.trim() ||
        '新課程';

    yield { step: 'done', message: '✓ 完成' };

    return {
        title: finalTitle,
        syllabus,
        sourceText: combined,
        sourceUrls,
        rootUrl: root.finalUrl,
    };
}

/* ════════════════════ fetch ════════════════════ */

interface FetchedPage {
    html: string;
    finalUrl: string;
    status: number;
    contentType: string;
}

async function fetchPage(url: string, signal?: AbortSignal): Promise<FetchedPage> {
    let res: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    // Chain user signal into our timeout-controlled one
    if (signal) {
        if (signal.aborted) {
            clearTimeout(timeoutId);
            throw new AgentError('aborted', '已取消。');
        }
        signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
        res = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 ClassNote-Agent/0.7',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            signal: controller.signal,
        });
    } catch (err) {
        clearTimeout(timeoutId);
        if (controller.signal.aborted) {
            throw new AgentError(
                'fetch-failed',
                signal?.aborted ? '已取消。' : '請求逾時（30 秒）。',
            );
        }
        throw new AgentError(
            'fetch-failed',
            (err as Error)?.message || '網路錯誤',
            err,
        );
    } finally {
        clearTimeout(timeoutId);
    }
    if (!res.ok) {
        throw new AgentError('fetch-failed', `HTTP ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (!/html|xml/i.test(contentType)) {
        throw new AgentError(
            'not-html',
            `不是 HTML 內容 (${contentType || 'unknown'})`,
        );
    }
    const html = await res.text();
    // Cap raw HTML at 2MB to prevent memory blowout
    if (html.length > 2_000_000) {
        throw new AgentError('not-html', `頁面太大 (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
    }
    return {
        html,
        finalUrl: res.url || url,
        status: res.status,
        contentType,
    };
}

/* ════════════════════ login wall detection ════════════════════ */

const KNOWN_LMS_HOST_RE = /\b(canvas|instructure|moodle|blackboard|sakai|gradescope)\b/i;
const LOGIN_PATH_TOKENS = [
    '/login',
    '/sign_in',
    '/signin',
    '/sign-in',
    '/auth',
    '/sso',
    '/oauth',
];

function detectLoginWall(page: FetchedPage): { blocked: boolean; reason: string } {
    if (page.status === 401 || page.status === 403) {
        return { blocked: true, reason: `HTTP ${page.status} — 需要登入。` };
    }
    let parsed: URL;
    try {
        parsed = new URL(page.finalUrl);
    } catch {
        return { blocked: false, reason: '' };
    }
    const path = parsed.pathname.toLowerCase();
    if (LOGIN_PATH_TOKENS.some((t) => path.includes(t))) {
        return { blocked: true, reason: '網址被導向登入頁。' };
    }

    const titleMatch = page.html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = (titleMatch?.[1] || '').trim();
    if (/login|sign\s?in|登入|登錄|登录|authentication/i.test(title)) {
        return {
            blocked: true,
            reason: `頁面標題顯示為登入頁：「${title.slice(0, 60)}」。`,
        };
    }

    const stripped = stripToText(page.html);
    const hasPasswordInput =
        /<input[^>]*type\s*=\s*["']?password/i.test(page.html);
    if (hasPasswordInput && stripped.length < 5000) {
        return { blocked: true, reason: '頁面包含密碼輸入框，疑為登入牆。' };
    }

    if (KNOWN_LMS_HOST_RE.test(parsed.host) && stripped.length < 3000) {
        return {
            blocked: true,
            reason: `${parsed.host} 是常見 LMS 平台，且公開頁面內容過少（疑似要登入）。`,
        };
    }

    return { blocked: false, reason: '' };
}

/* ════════════════════ HTML strip / text extract ════════════════════ */

const ENTITIES: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
    '&times;': '×',
    '&divide;': '÷',
    '&copy;': '©',
    '&reg;': '®',
};

function decodeEntities(s: string): string {
    return s
        .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/**
 * Strip aggressively for login-wall detection: full text, no structure.
 */
function stripToText(html: string): string {
    return html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Structured strip for AI input: preserves paragraph / line breaks for
 * readability, drops chrome (nav/footer/etc.).
 */
function extractText(html: string): { title: string; text: string } {
    let s = html;
    // 1. Strip HTML comments first (otherwise `-->` leaks into text)
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    // 2. Pull title before stripping head
    const titleMatch = s.match(/<title>([\s\S]*?)<\/title>/i);
    const title = decodeEntities((titleMatch?.[1] || '').replace(/\s+/g, ' ').trim());
    // 3. Drop chrome
    s = s
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<head[\s\S]*?<\/head>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<aside[\s\S]*?<\/aside>/gi, '');
    // 4. Preserve structure: replace block-end tags with newline before stripping all tags
    s = s
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|li|h[1-6]|tr|div|section|article|ul|ol)>/gi, '\n');
    // 5. Drop all remaining tags
    s = s.replace(/<[^>]+>/g, ' ');
    // 6. Decode entities
    s = decodeEntities(s);
    // 7. Collapse whitespace (tabs/spaces only; newlines preserved for blocks)
    s = s
        .replace(/[ \t]+/g, ' ')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    // 8. Cap
    if (s.length > PER_PAGE_TEXT_CAP) {
        s = s.slice(0, PER_PAGE_TEXT_CAP) + '\n\n…[truncated]';
    }
    return { title, text: s };
}

/* ════════════════════ link discovery ════════════════════ */

interface Candidate {
    href: string;
    text: string;
    score: number;
}

function discoverCandidates(rootHtml: string, rootUrl: string): Candidate[] {
    let baseOrigin: string;
    let basePath: string;
    try {
        const u = new URL(rootUrl);
        baseOrigin = u.origin;
        // Drop trailing filename, keep directory path (so /a/b/index.html → /a/b/)
        basePath = u.pathname.replace(/\/[^/]*$/, '/') || '/';
    } catch {
        return [];
    }

    const re = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Map<string, Candidate>();
    let m;
    while ((m = re.exec(rootHtml))) {
        const rawHref = m[1];
        if (
            rawHref.startsWith('#') ||
            rawHref.startsWith('mailto:') ||
            rawHref.startsWith('tel:') ||
            rawHref.startsWith('javascript:')
        ) {
            continue;
        }
        let abs: URL;
        try {
            abs = new URL(rawHref, rootUrl);
        } catch {
            continue;
        }
        if (abs.origin !== baseOrigin) continue;
        // Only same-or-deeper path (don't crawl up to other parts of site)
        const absPathLower = abs.pathname.toLowerCase();
        if (!absPathLower.startsWith(basePath.toLowerCase())) continue;
        const finalHref = abs.href.replace(/#.*$/, '');
        if (finalHref === rootUrl || finalHref === rootUrl + '/') continue;

        const text = decodeEntities(
            m[2]
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .trim(),
        );
        if (!text) continue;

        const lower = (text + ' ' + finalHref).toLowerCase();
        let textScore = 0;
        if (/syllabus|課綱|大綱/.test(lower)) textScore += 5;
        if (/schedule|進度|行事|calendar/.test(lower)) textScore += 4;
        if (/policies|policy|grading|評分|grade/.test(lower)) textScore += 3;
        if (/about|overview|description|介紹|簡介/.test(lower)) textScore += 2;
        let score = textScore;
        // Negative
        if (/login|register|contact|關於我們/.test(lower)) score -= 5;
        if (/homework|hw\d|assignment\s*\d|quiz\s*\d|lab\s*\d/i.test(text)) score -= 1;
        if (/\.(zip|tar|gz|jpg|png|gif|mp4|mov)$/i.test(finalHref)) score -= 5;
        // PDF: only boost when anchor text already showed syllabus-y signal.
        // Blanket +4 mistakenly grabs slides / lecture material PDFs on
        // course pages where the root already has the syllabus content.
        if (/\.pdf$/i.test(finalHref) && textScore >= 2) score += 2;

        const prev = seen.get(finalHref);
        if (!prev || prev.score < score) {
            seen.set(finalHref, { href: finalHref, text: text.slice(0, 60), score });
        }
    }

    return Array.from(seen.values()).sort((a, b) => b.score - a.score);
}

/* ════════════════════ test exports (unit tests pull these) ════════════════════ */

export const __testExports = {
    detectLoginWall,
    extractText,
    stripToText,
    discoverCandidates,
    decodeEntities,
};
