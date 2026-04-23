# ClassNoteAI Evaluation Harness

Nightly quality-regression harness for the three subjective parts of
the app that unit tests cannot cover:

1. **ASR** — Whisper transcription accuracy on golden audio
2. **RAG** — retrieval quality (MRR@10) on Chinese queries over
   English lecture content
3. **Summary** — LLM-as-judge grading of produced study notes

Runs nightly via `.github/workflows/eval-nightly.yml`. Results are
committed to `evals/reports/` as markdown so drift is visible in
git blame.

## Why this exists, not just unit tests

Unit tests catch structural bugs (the embedding model failing to
load, the Whisper language param being hardcoded). They can't catch:

- Fine refinement prompts slowly drifting into over-correction
- Summary quality degrading on 90-minute lectures vs 30-minute ones
- Cross-lingual retrieval breaking on a specific vocabulary domain
- VAD thresholds being wrong for a new microphone / classroom

These failures only surface at quality time. The harness keeps
golden fixtures and tracks metrics across runs so regressions show up
as "MRR@10 dropped from 0.74 to 0.51 last week" rather than "users
stopped trusting the AI tutor over 3 months".

## Directory layout

```
evals/
  fixtures/
    asr/                  # *.wav + *.reference.txt pairs
    rag/                  # *.corpus.json + *.queries.json
    summary/              # *.transcript.txt + *.rubric.json
  scripts/
    asr-wer.ts
    rag-mrr.ts
    summary-judge.ts
    report.ts
  reports/                # generated, gitignored
```

## Running locally

```bash
npm run eval:asr          # WER against audio fixtures
npm run eval:rag          # MRR@10 against rag fixtures
npm run eval:summary      # LLM-as-judge against summary fixtures
npm run eval:all          # all three + produces the report
npm run smoke:ocr -- --provider all --pdf /abs/path/lecture.pdf --page 1 --expect "Database Management Systems"
```

## OCR smoke test

`npm run smoke:ocr` is the quick "does remote OCR still work right now?"
check for the two shipped providers:

- `github-models`
- `chatgpt-oauth`

Example:

```bash
npm run smoke:ocr -- \
  --provider all \
  --pdf "/Users/me/Documents/lecture.pdf" \
  --page 1 \
  --expect "Database Management Systems"
```

Auth resolution:

- `github-models`: `GITHUB_MODELS_PAT`, otherwise `gh auth token`
- `chatgpt-oauth`: `CHATGPT_ACCESS_TOKEN` / `CHATGPT_REFRESH_TOKEN`, otherwise `~/.codex/auth.json`

Notes:

- Requires `pdftoppm` on `PATH` (Poppler) to render the PDF page image.
- The script exits non-zero if OCR output is empty or any `--expect` string is missing.
- Use `--json` for machine-readable output, or `--keep-artifacts` to keep the rendered page image for debugging.

## Adding a fixture

### ASR fixture

Drop a `<name>.wav` + `<name>.reference.txt` pair in `evals/fixtures/asr/`.
The reference is the ground-truth transcript as a human would write it.

### RAG fixture

```json
// evals/fixtures/rag/my-lecture.corpus.json
{ "chunks": [{ "id": "c1", "text": "..." }, ...] }

// evals/fixtures/rag/my-lecture.queries.json
{ "queries": [{ "query": "...", "gold": ["c3", "c7"] }, ...] }
```

### Summary fixture

```json
// evals/fixtures/summary/my-lecture.rubric.json
{
  "must_cover": ["heuristic evaluation", "Fitts's Law", ...],
  "must_not_hallucinate": ["deep learning"],
  "min_length_chars": 500
}
```

## CI integration

The nightly workflow runs `npm run eval:all`, writes
`evals/reports/YYYY-MM-DD.md`, and opens a PR if the numbers
regressed by more than the thresholds in `evals/scripts/report.ts`.

## What NOT to put here

- Unit tests → those go in `src/**/__tests__/` (vitest) or
  `src-tauri/src/**/tests` (cargo test)
- Integration tests that need real model files — those stay in
  `pr-check` under `cargo test --lib` and download fixtures via the
  `download-test-fixtures.sh` script
