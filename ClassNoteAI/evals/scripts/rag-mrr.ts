/**
 * RAG Mean Reciprocal Rank evaluation.
 *
 * Each fixture is (corpus, queries-with-gold). For each query we run
 * the full RAG retrieval path (translate-query if CJK, embed via
 * bge-small-en, top-K search) and record the rank of the first gold
 * passage. MRR@K = mean of 1/rank across queries; higher is better.
 *
 * This is the skeleton. Wiring the full retrieval pipeline from a
 * Node-side script requires either spinning up the Tauri runtime or
 * reimplementing the path server-side — left for the follow-up PR.
 * For now the script validates fixture shape and emits a report so
 * CI doesn't fail on an empty fixtures directory.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures', 'rag');
const reportsDir = join(here, '..', 'reports');

interface RagQuery {
    query: string;
    gold: string[]; // chunk ids that are actually relevant
}

interface FixtureResult {
    name: string;
    queries: number;
    corpusSize: number;
    mrr: number;
    recallAt5: number;
    note: string;
}

/** MRR for a single query given a ranked list of chunk ids. */
export function reciprocalRank(ranked: string[], gold: string[]): number {
    for (let i = 0; i < ranked.length; i++) {
        if (gold.includes(ranked[i])) return 1 / (i + 1);
    }
    return 0;
}

/** Recall@K for a single query. */
export function recallAt(k: number, ranked: string[], gold: string[]): number {
    if (gold.length === 0) return 0;
    const topK = ranked.slice(0, k);
    const hits = topK.filter((id) => gold.includes(id)).length;
    return hits / gold.length;
}

async function listFixtures(): Promise<string[]> {
    try {
        const names = await readdir(fixturesDir);
        return names
            .filter((n) => n.endsWith('.corpus.json'))
            .map((n) => n.replace(/\.corpus\.json$/, ''));
    } catch {
        return [];
    }
}

async function runFixture(name: string): Promise<FixtureResult> {
    const corpusPath = join(fixturesDir, `${name}.corpus.json`);
    const queriesPath = join(fixturesDir, `${name}.queries.json`);
    let queries: RagQuery[] = [];
    let corpusSize = 0;
    try {
        const corpus = JSON.parse(await readFile(corpusPath, 'utf-8'));
        const q = JSON.parse(await readFile(queriesPath, 'utf-8'));
        corpusSize = Array.isArray(corpus.chunks) ? corpus.chunks.length : 0;
        queries = Array.isArray(q.queries) ? q.queries : [];
    } catch (err) {
        return {
            name,
            queries: 0,
            corpusSize: 0,
            mrr: 0,
            recallAt5: 0,
            note: `fixture parse error: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    // TODO: run the real retrieval pipeline. Stubbed so empty reports
    // are visible and shape is validated.
    const ranks: number[] = [];
    const recalls: number[] = [];
    for (const _q of queries) {
        ranks.push(0);
        recalls.push(0);
    }
    const mrr = ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : 0;
    const recallAt5 = recalls.length > 0 ? recalls.reduce((a, b) => a + b, 0) / recalls.length : 0;
    return {
        name,
        queries: queries.length,
        corpusSize,
        mrr,
        recallAt5,
        note: 'retrieval pipeline not wired yet — see evals/README.md',
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
        `# RAG MRR Report (${date})`,
        '',
        `Fixtures: **${results.length}**`,
        '',
        '| Name | Queries | Corpus | MRR@10 | Recall@5 | Note |',
        '| --- | ---: | ---: | ---: | ---: | --- |',
    ];
    for (const r of results) {
        lines.push(
            `| ${r.name} | ${r.queries} | ${r.corpusSize} | ${r.mrr.toFixed(3)} | ${r.recallAt5.toFixed(3)} | ${r.note} |`,
        );
    }
    if (results.length === 0) {
        lines.push('| — | — | — | — | — | no fixtures in evals/fixtures/rag yet |');
    }
    await writeFile(join(reportsDir, `rag-mrr-${date}.md`), lines.join('\n'));
    console.log(`[eval:rag] wrote report: reports/rag-mrr-${date}.md`);
}

// Allow both direct invocation and import-for-testing.
if (
    import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop() ?? '')
) {
    main().catch((err) => {
        console.error('[eval:rag] fatal:', err);
        process.exit(1);
    });
}
