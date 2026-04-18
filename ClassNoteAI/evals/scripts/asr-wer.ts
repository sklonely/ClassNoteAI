/**
 * ASR Word Error Rate evaluation.
 *
 * For each (audio, reference) pair in evals/fixtures/asr/, runs the
 * configured Whisper model and computes Levenshtein-word-distance WER
 * against the reference transcript. Outputs per-fixture + aggregate
 * numbers so drift is trackable across runs.
 *
 * This is the skeleton — it intentionally does NOT currently invoke
 * whisper.cpp (needs the Tauri runtime or a standalone whisper
 * binary). The next PR will add a Node-side whisper.cpp binding or
 * a child_process call. For now it validates fixture layout and
 * produces an empty report so the nightly workflow doesn't break.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures', 'asr');
const reportsDir = join(here, '..', 'reports');

interface FixtureResult {
    name: string;
    referenceWords: number;
    hypothesisWords: number;
    wer: number;
    note: string;
}

/** Word-level Levenshtein distance → WER. Standard ASR metric. */
export function computeWer(reference: string, hypothesis: string): number {
    const ref = reference.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hyp = hypothesis.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
    // Iterative Wagner-Fischer. O(n*m) memory; fine for typical
    // lecture-length transcripts (thousands of words).
    const m = ref.length;
    const n = hyp.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1, // deletion
                dp[i][j - 1] + 1, // insertion
                dp[i - 1][j - 1] + cost, // substitution
            );
        }
    }
    return dp[m][n] / m;
}

async function listFixtures(): Promise<string[]> {
    try {
        const names = await readdir(fixturesDir);
        return names
            .filter((n) => n.endsWith('.wav') || n.endsWith('.WAV'))
            .map((n) => basename(n, extname(n)));
    } catch {
        return [];
    }
}

async function runFixture(name: string): Promise<FixtureResult> {
    const refPath = join(fixturesDir, `${name}.reference.txt`);
    let reference = '';
    try {
        reference = await readFile(refPath, 'utf-8');
    } catch {
        return {
            name,
            referenceWords: 0,
            hypothesisWords: 0,
            wer: 1,
            note: `missing ${name}.reference.txt`,
        };
    }
    // TODO: invoke whisper.cpp on the .wav and capture hypothesis.
    // For now we stub the hypothesis as empty so fixtures are visible
    // in the report with an explicit "not yet wired" note.
    const hypothesis = '';
    return {
        name,
        referenceWords: reference.trim().split(/\s+/).filter(Boolean).length,
        hypothesisWords: 0,
        wer: computeWer(reference, hypothesis),
        note: 'whisper invocation not wired yet — see evals/README.md',
    };
}

async function main() {
    const names = await listFixtures();
    const results: FixtureResult[] = [];
    for (const name of names) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await runFixture(name));
    }
    await mkdir(reportsDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const lines: string[] = [
        `# ASR WER Report (${date})`,
        '',
        `Fixtures: **${results.length}**`,
        '',
        '| Name | Ref words | Hyp words | WER | Note |',
        '| --- | ---: | ---: | ---: | --- |',
    ];
    for (const r of results) {
        lines.push(
            `| ${r.name} | ${r.referenceWords} | ${r.hypothesisWords} | ${(r.wer * 100).toFixed(1)}% | ${r.note} |`,
        );
    }
    if (results.length === 0) {
        lines.push('| — | — | — | — | no fixtures in evals/fixtures/asr yet |');
    }
    await writeFile(join(reportsDir, `asr-wer-${date}.md`), lines.join('\n'));
    console.log(`[eval:asr] wrote report: reports/asr-wer-${date}.md`);
}

// Allow both direct invocation and import-for-testing.
if (
    import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop() ?? '')
) {
    main().catch((err) => {
        console.error('[eval:asr] fatal:', err);
        process.exit(1);
    });
}
