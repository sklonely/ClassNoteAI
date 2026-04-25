import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { segmentTranscriptForEval } from '../../src/services/streaming/transcriptSegmenter';

interface SubtitleRow {
  lecture_id: string;
  timestamp: number;
  text_en: string;
}

interface EvalResult {
  name: string;
  segments: number;
  meanWords: number;
  p50Words: number;
  p75Words: number;
  p95Words: number;
  maxWords: number;
  over75: number;
  weakTailPct: number;
  samples: Array<{ words: number; text: string }>;
}

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) {
    args.set(process.argv[i].slice(2), process.argv[i + 1] ?? '');
    i++;
  }
}

const lectureId = args.get('lecture') || '';
const rows = readLatestLectureRows(lectureId);
const transcript = rows.map((row) => row.text_en.trim()).filter(Boolean).join(' ');

const strategies: Array<[string, string[]]> = [
  ['current-db', rows.map((row) => row.text_en)],
  ['punctuation-only', punctuationOnly(transcript)],
  ['soft-semantic', segmentTranscriptForEval(transcript)],
  ['soft-semantic-compact', segmentTranscriptForEval(transcript, {
    softMinWords: 26,
    preferredMinWords: 20,
    preferredMaxWords: 38,
    lateWords: 40,
    hardMaxWords: 68,
  })],
];

const report = strategies.map(([name, segments]) => summarize(name, segments));
const outDir = join(process.cwd(), 'evals', 'reports');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `segmenter-${Date.now()}.json`);
writeFileSync(outPath, JSON.stringify({ lectureId: rows[0]?.lecture_id, report }, null, 2));

for (const item of report) {
  console.log(JSON.stringify(item));
}
console.log(`report: ${outPath}`);

function readLatestLectureRows(id: string): SubtitleRow[] {
  const appData = process.env.APPDATA;
  if (!appData) throw new Error('APPDATA is not set; pass an exported transcript in a follow-up if needed.');
  const dbPath = join(appData, 'com.classnoteai', 'classnoteai.db');
  if (!existsSync(dbPath)) throw new Error(`DB not found: ${dbPath}`);

  const py = String.raw`
import json, sqlite3, sys
db, lecture_id = sys.argv[1], sys.argv[2]
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
cur = con.cursor()
if lecture_id:
    lid = lecture_id
else:
    row = cur.execute("""
        select id from lectures
        where exists (select 1 from subtitles where subtitles.lecture_id = lectures.id)
        order by datetime(coalesce(updated_at, created_at)) desc
        limit 1
    """).fetchone()
    lid = row["id"] if row else ""
rows = cur.execute("""
    select lecture_id, timestamp, text_en
    from subtitles
    where lecture_id = ?
    order by timestamp
""", (lid,)).fetchall()
print(json.dumps([dict(r) for r in rows], ensure_ascii=False))
`;

  const output = runPython(py, [dbPath, id]);
  const rows = JSON.parse(output.replace(/^\uFEFF/, '')) as SubtitleRow[];
  if (rows.length === 0) throw new Error(`No subtitles found for lecture ${id || '<latest>'}`);
  return rows;
}

function runPython(script: string, args: string[]): string {
  for (const bin of ['py', 'python', 'python3']) {
    try {
      return execFileSync(bin, ['-', ...args], {
        input: script,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // Try the next Python launcher.
    }
  }
  throw new Error('Python with sqlite3 is required for DB-backed segmenter eval.');
}

function punctuationOnly(text: string): string[] {
  return text
    .split(/(?<=(?:[.!?]|\u3002|\uFF01|\uFF1F))\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function summarize(name: string, rawSegments: string[]): EvalResult {
  const segments = rawSegments.map((s) => s.trim()).filter(Boolean);
  const counts = segments.map(wordCount).sort((a, b) => a - b);
  const weak = segments.filter(hasWeakTail).length;
  const samples = segments
    .map((text) => ({ words: wordCount(text), text }))
    .sort((a, b) => b.words - a.words)
    .slice(0, 5);
  const mean = counts.reduce((sum, n) => sum + n, 0) / Math.max(1, counts.length);
  return {
    name,
    segments: segments.length,
    meanWords: round(mean),
    p50Words: percentile(counts, 0.5),
    p75Words: percentile(counts, 0.75),
    p95Words: percentile(counts, 0.95),
    maxWords: counts.at(-1) ?? 0,
    over75: counts.filter((n) => n > 75).length,
    weakTailPct: round((weak / Math.max(1, segments.length)) * 100),
    samples,
  };
}

function wordCount(text: string): number {
  return (text.match(/[A-Za-z0-9]+(?:['.-][A-Za-z0-9]+)*/g) ?? []).length;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function hasWeakTail(text: string): boolean {
  return /\b(?:and|or|but|so|if|because|to|the|a|an|we|you|i|can|will|would|should|is|are|with|for|in|of|this|that|which|who|what|how)$/i
    .test(text.trim());
}
