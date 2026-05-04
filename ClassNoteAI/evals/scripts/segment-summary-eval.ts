/**
 * cp75.17 / cp75.18 segmentation + summary smoke eval.
 *
 * Pulls the latest lecture's subtitles from the dev SQLite DB
 * (`%APPDATA%/com.classnoteai/classnoteai.db`), builds the same
 * timestamped transcript that `runBackgroundSummary` would feed
 * the segmenter, and:
 *   1. Always: writes the prompt + transcript sample to stdout +
 *      `evals/reports/segment-summary-<ts>.json` for inspection.
 *   2. If `OPENAI_API_KEY` is set: hits OpenAI's Chat Completions
 *      endpoint directly (model `gpt-4.1` by default) and prints
 *      the parsed Section[] result.
 *
 * Usage:
 *   $env:OPENAI_API_KEY = "sk-..."    # PowerShell
 *   npx tsx evals/scripts/segment-summary-eval.ts [--lecture <id>]
 *
 * Why a standalone script and not a vitest run:
 *   - Vitest mocks LLM providers; this is the inverse — exercise the
 *     real prompt against a real model with the real transcript.
 *   - We need OS-level appdata access for the DB; jsdom doesn't have it.
 *
 * What this proves:
 *   - The transcript builder produces well-formed `[mm:ss] line` markers
 *     even on lectures with absolute-epoch subtitle timestamps (cp75.18).
 *   - The segmenter prompt + parser actually produces a useful TOC
 *     (3-10 chronological sections) on a real 90-min recording.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface SubtitleRow {
    lecture_id: string;
    timestamp: number;
    text_en: string | null;
    text_zh: string | null;
}

interface SegmenterSection {
    timestamp: number;
    title: string;
    summary?: string;
}

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) {
        args.set(process.argv[i].slice(2), process.argv[i + 1] ?? '');
        i++;
    }
}

const requestedLectureId = args.get('lecture') ?? '';
const model = args.get('model') ?? 'gpt-4.1';
const language = (args.get('language') ?? 'en') as 'zh' | 'en';

const { id: lectureId, rows } = readLatestLectureRows(requestedLectureId);
if (rows.length === 0) {
    console.error(`No subtitles found for lecture ${lectureId || '<latest>'}`);
    process.exit(1);
}

// Three-way normalisation — same logic as the production code in
// recordingSessionService cp75.18. See its comment block for the
// rationale.
const firstTs = rows[0].timestamp;
const normalizeTs: (t: number) => number =
    firstTs >= 1_000_000_000_000
        ? (t) => Math.max(0, (t - firstTs) / 1000)
        : firstTs >= 1_000_000_000
          ? (t) => Math.max(0, t - firstTs)
          : (t) => Math.max(0, t);

const transcriptWithTs = rows
    .map((r) => {
        const txt = (r.text_en || r.text_zh || '').trim();
        if (!txt) return '';
        const ts = Math.floor(normalizeTs(r.timestamp));
        const mm = Math.floor(ts / 60).toString().padStart(2, '0');
        const ss = Math.floor(ts % 60).toString().padStart(2, '0');
        return `[${mm}:${ss}] ${txt}`;
    })
    .filter(Boolean)
    .join('\n');

const lastRel = normalizeTs(rows[rows.length - 1].timestamp);
console.log('=== TRANSCRIPT INFO ===');
console.log(`lecture_id: ${lectureId}`);
console.log(`subtitles:  ${rows.length}`);
console.log(`duration:   ~${Math.floor(lastRel / 60)}m${Math.floor(lastRel) % 60}s`);
console.log(`chars:      ${transcriptWithTs.length}`);
console.log();
console.log('=== TRANSCRIPT SAMPLE (first 8 lines) ===');
console.log(transcriptWithTs.split('\n').slice(0, 8).join('\n'));
console.log('...');
console.log('=== TRANSCRIPT SAMPLE (last 4 lines) ===');
console.log(transcriptWithTs.split('\n').slice(-4).join('\n'));
console.log();

const langName = language === 'zh' ? '繁體中文' : 'English';
const segmenterSystemPrompt =
    `You are a lecture-transcript segmenter. Identify *topical* shift ` +
    `points in the transcript and produce a navigable table-of-contents.\n\n` +
    `Input: a transcript with [mm:ss] timestamp prefixes per line.\n\n` +
    `Output: a JSON array. Each element MUST be an object with exactly:\n` +
    `  - "timestamp": integer seconds where this topic begins. Parse it ` +
    `from the [mm:ss] of the line that opens this section. DO NOT invent ` +
    `times not in the transcript. The first section MUST have timestamp 0.\n` +
    `  - "title": a short topic title (≤ 15 ${langName} characters / words). ` +
    `No decorations like "Part 1", "第一段", "Section 3:". Just the topic.\n` +
    `  - "summary": 1-2 sentences in ${langName} on what the section covers, ` +
    `so a reader skimming the TOC can decide whether to jump in.\n\n` +
    `Topic-shift signals (any one is enough — be CONSERVATIVE, prefer ` +
    `fewer, larger sections over many tiny ones):\n` +
    `  1. Speaker explicitly announces a transition: "next we'll", ` +
    `"接下來", "我們現在開始", "let's move on", "第二部分".\n` +
    `  2. Speaker role change: presenter handover, instructor takes over, ` +
    `Q&A starts.\n` +
    `  3. Domain leap: theory → implementation; history → current ` +
    `application; topic A → topic B with no continuity.\n\n` +
    `DO NOT:\n` +
    `  - Split every minute. Target 3-10 sections regardless of duration.\n` +
    `  - Use study-note categories like "Overview / Key Concepts / ` +
    `Examples / Review" — that's the summary's job, NOT yours.\n` +
    `  - Invent topics not actually discussed in the transcript.\n` +
    `  - Output anything other than the JSON array — no markdown ` +
    `fences, no preamble, no trailing commentary.\n\n` +
    `Sections must be in chronological order. The transcript follows.`;

const apiKey = process.env.OPENAI_API_KEY;
const useCodex = args.has('via-codex');
const reportsDir = join(process.cwd(), 'evals', 'reports');
mkdirSync(reportsDir, { recursive: true });
const reportPath = join(reportsDir, `segment-summary-${Date.now()}.json`);

const baseReport = {
    timestamp: new Date().toISOString(),
    lectureId,
    subtitles: rows.length,
    durationSec: Math.floor(lastRel),
    transcriptChars: transcriptWithTs.length,
    transcriptSample: {
        first8Lines: transcriptWithTs.split('\n').slice(0, 8),
        last4Lines: transcriptWithTs.split('\n').slice(-4),
    },
    segmenterSystemPrompt,
    model: useCodex ? 'codex-cli (chatgpt-oauth)' : model,
    language,
};

if (!apiKey && !useCodex) {
    console.log('=== NO LIVE LLM PATH AVAILABLE — skipping LLM call ===');
    console.log('Either set OPENAI_API_KEY or pass --via-codex (uses ChatGPT subscription via codex CLI).');
    writeFileSync(reportPath, JSON.stringify(baseReport, null, 2));
    console.log(`Wrote inspection-only report to ${reportPath}`);
    process.exit(0);
}

const callerLabel = useCodex
    ? `codex CLI (ChatGPT OAuth, model=gpt-5)`
    : `OpenAI Chat Completions (model=${model})`;
console.log(`=== CALLING ${callerLabel}, transcript=${transcriptWithTs.length} chars ===`);
const startedAt = Date.now();
const promise = useCodex
    ? runSegmenterViaCodex(segmenterSystemPrompt, transcriptWithTs)
    : runSegmenter(apiKey!, model, segmenterSystemPrompt, transcriptWithTs);

promise
    .then((result) => {
        const elapsedMs = Date.now() - startedAt;
        console.log(`Got ${result.sections.length} sections in ${elapsedMs}ms`);
        console.log();
        console.log('=== SECTIONS ===');
        for (const s of result.sections) {
            const mm = Math.floor(s.timestamp / 60).toString().padStart(2, '0');
            const ss = Math.floor(s.timestamp % 60).toString().padStart(2, '0');
            console.log(`[${mm}:${ss}] ${s.title}`);
            if (s.summary) console.log(`        ${s.summary}`);
        }
        writeFileSync(
            reportPath,
            JSON.stringify(
                { ...baseReport, elapsedMs, rawResponse: result.raw, sections: result.sections },
                null,
                2,
            ),
        );
        console.log();
        console.log(`Wrote full report to ${reportPath}`);
    })
    .catch((err) => {
        console.error('Segmenter call failed:', err);
        writeFileSync(
            reportPath,
            JSON.stringify(
                {
                    ...baseReport,
                    error: err instanceof Error ? err.message : String(err),
                },
                null,
                2,
            ),
        );
        process.exit(1);
    });

// ─── Helpers ────────────────────────────────────────────────────────

function readLatestLectureRows(id: string): { id: string; rows: SubtitleRow[] } {
    const appData = process.env.APPDATA;
    if (!appData) {
        throw new Error('APPDATA is not set; cannot locate the dev SQLite DB.');
    }
    const dbPath = join(appData, 'com.classnoteai', 'classnoteai.db');
    if (!existsSync(dbPath)) throw new Error(`DB not found: ${dbPath}`);

    const py = String.raw`
import json, sqlite3, sys
# Windows console cp950 chokes on 简 / 繁 chars; force UTF-8.
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
db, lecture_id = sys.argv[1], sys.argv[2]
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
cur = con.cursor()
if lecture_id:
    lid = lecture_id
else:
    # Pick the most-recently-CREATED lecture that has at least 50
    # subtitles — that's the user's most recent real recording, not a
    # 5-second smoke test ping. Ordering by updated_at would re-rank
    # an older lecture that the user just touched (e.g. by re-running
    # a summary on it), which is not what we want.
    row = cur.execute("""
        select l.id as lid, count(s.id) as cnt
        from lectures l
        left join subtitles s on s.lecture_id = l.id
        where l.is_deleted = 0
        group by l.id
        having cnt >= 50
        order by datetime(l.created_at) desc
        limit 1
    """).fetchone()
    lid = row["lid"] if row else ""
rows = cur.execute("""
    select lecture_id, timestamp, text_en, text_zh
    from subtitles
    where lecture_id = ?
    order by timestamp
""", (lid,)).fetchall()
print(json.dumps({"lectureId": lid, "rows": [dict(r) for r in rows]}, ensure_ascii=False))
`;

    const out = runPython(py, [dbPath, id]);
    const parsed = JSON.parse(out.replace(/^﻿/, '')) as {
        lectureId: string;
        rows: SubtitleRow[];
    };
    return { id: parsed.lectureId, rows: parsed.rows };
}

function runPython(script: string, scriptArgs: string[]): string {
    const errors: string[] = [];
    for (const bin of ['py', 'python', 'python3']) {
        try {
            return execFileSync(bin, ['-', ...scriptArgs], {
                input: script,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                maxBuffer: 1024 * 1024 * 64,
            });
        } catch (e) {
            const err = e as Error & { stderr?: string };
            errors.push(`${bin}: ${err.message}\n${err.stderr ?? ''}`);
        }
    }
    throw new Error(
        'Python with sqlite3 is required to read the dev DB.\n' +
            errors.join('\n---\n'),
    );
}

/** Drive `codex exec` non-interactively to run the segmenter prompt
 *  through the user's ChatGPT subscription (same OAuth path our app's
 *  chatgpt-oauth provider uses). No OPENAI_API_KEY needed.
 *
 *  Strategy:
 *    - Pipe the combined `<system>\n<transcript>` to codex via stdin
 *    - `--output-schema` forces a `{sections: [...]}` JSON shape
 *    - `--output-last-message` writes only the final agent reply to a
 *      temp file (we don't have to parse the full event stream)
 *    - `--sandbox read-only` + `--ephemeral` + `--skip-git-repo-check`
 *      keep codex from doing anything besides reasoning + emitting JSON
 *    - `--ignore-rules` + `--ignore-user-config` to dodge any user
 *      AGENTS.md or codex policy that might inject coding-task-style
 *      reasoning */
async function runSegmenterViaCodex(
    systemPrompt: string,
    transcript: string,
): Promise<{ sections: SegmenterSection[]; raw: string }> {
    const schema = {
        type: 'object',
        properties: {
            sections: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        timestamp: { type: 'integer' },
                        title: { type: 'string' },
                        summary: { type: 'string' },
                    },
                    required: ['timestamp', 'title'],
                    additionalProperties: false,
                },
            },
        },
        required: ['sections'],
        additionalProperties: false,
    };
    const schemaPath = join(tmpdir(), `segmenter-schema-${Date.now()}.json`);
    const outPath = join(tmpdir(), `segmenter-out-${Date.now()}.txt`);
    writeFileSync(schemaPath, JSON.stringify(schema));

    // Codex' agent harness wants a coding-task-shaped instruction. We
    // wrap the segmenter prompt in a clear "this is a single-shot
    // structured-output task, do not call any tools, do not write any
    // files" envelope so it doesn't try to be helpful.
    const fullPrompt =
        `You are running in a non-interactive structured-output mode.\n` +
        `Do NOT call any tools.\n` +
        `Do NOT write any files.\n` +
        `Do NOT explore the codebase.\n` +
        `Output ONLY the JSON object that matches the provided schema.\n` +
        `\n` +
        `=== SYSTEM PROMPT ===\n` +
        systemPrompt +
        `\n\n=== TRANSCRIPT ===\n` +
        transcript;

    const codexArgs = [
        'exec',
        '--sandbox', 'read-only',
        '--ephemeral',
        '--skip-git-repo-check',
        '--ignore-rules',
        '--ignore-user-config',
        '--output-schema', schemaPath,
        '--output-last-message', outPath,
        '-', // read prompt from stdin
    ];

    const result = spawnSync('codex', codexArgs, {
        input: fullPrompt,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024 * 64,
    });
    try {
        if (result.status !== 0) {
            throw new Error(
                `codex exec exited with status ${result.status}: ${result.stderr ?? ''}`,
            );
        }
        if (!existsSync(outPath)) {
            throw new Error('codex exec did not produce an output file');
        }
        const raw = readFileSync(outPath, 'utf8').trim();
        // The output may be wrapped in fenced code block — re-use the
        // same tolerant parser the production code uses.
        let parsed: unknown;
        const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/m.exec(raw);
        const txt = fenced ? fenced[1].trim() : raw;
        try {
            parsed = JSON.parse(txt);
        } catch {
            const m = /\{\s*"sections"[\s\S]*\}/.exec(txt);
            if (!m) throw new Error(`codex output not JSON: ${txt.slice(0, 200)}`);
            parsed = JSON.parse(m[0]);
        }
        const sections = (parsed as { sections?: SegmenterSection[] }).sections;
        if (!Array.isArray(sections)) {
            throw new Error(`codex output missing "sections" array: ${txt.slice(0, 200)}`);
        }
        return { sections, raw };
    } finally {
        try { unlinkSync(schemaPath); } catch { /* best effort */ }
        try { unlinkSync(outPath); } catch { /* best effort */ }
    }
}

async function runSegmenter(
    key: string,
    modelId: string,
    systemPrompt: string,
    transcript: string,
): Promise<{ sections: SegmenterSection[]; raw: string }> {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
            model: modelId,
            temperature: 0.1,
            max_tokens: 2048,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content:
                        systemPrompt +
                        '\n\nReturn the array WRAPPED IN AN OBJECT: {"sections": [...]} ' +
                        '— OpenAI\'s json_object mode requires a top-level object.',
                },
                { role: 'user', content: transcript },
            ],
        }),
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`OpenAI ${resp.status}: ${body.slice(0, 500)}`);
    }
    const data = (await resp.json()) as {
        choices: Array<{ message: { content: string } }>;
    };
    const raw = data.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as { sections?: SegmenterSection[] };
    if (!Array.isArray(parsed.sections)) {
        throw new Error(`Model did not return {"sections": [...]}; got: ${raw.slice(0, 300)}`);
    }
    return { sections: parsed.sections, raw };
}
