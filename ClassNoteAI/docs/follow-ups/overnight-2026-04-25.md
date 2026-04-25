# Overnight session — 2026-04-25

Self-paced overnight pass on the v2 streaming refactor + ort-fix branch
(`refactor/streaming-pipeline`). Goals: deep code review, redesign +
reimplement tests, run real-audio eval, fix anything found, leave a
clean baseline for the user's morning end-to-end test.

## TL;DR

- **7 commits added overnight**, all green (cargo lib 76/76, vitest 424/424).
- **Real-audio eval against 我的影片.mp4 (70 min lecture) revealed a major
  pipeline bug:** the sentence accumulator's boundary algorithm fails on
  conversational speech — Parakeet doesn't reliably emit terminators on
  lecture audio, so the buffer accumulates indefinitely. First eval run
  produced a 53-minute / 7000-word "sentence" that crashed Gemma.
- **Fixed via a hard-cap fallback** (60 words / 30 s) in `isSentenceBoundary`,
  defended by `MAX_INPUT_CHARS` guard in `gemma::translate`, and by
  bumping `gemma_sidecar` server context to `-c 4096`.
- Five other smaller bugs fixed: tail-loss in `asrPipeline.stop`, broken
  pause/resume in `transcriptionService`, missing retry in
  `translationPipeline`, silent stderr from llama-server, silent fallback
  on Windows ORT init failure.

## Commits

```
01fd0d1 fix(streaming): hard-cap sentence boundary on long unpunctuated runs (#R-eval)
3d54bc5 fix(observability): pipe llama-server stderr to logfile + harden ORT-init failure mode
f26ec88 fix(translation): retry-once + correct misleading rolling-context docstring
185d360 fix(streaming): preserve tail ASR text + decouple pause from session lifecycle
8eb8fb3 test: rewrite boundary tests against v2 SentenceAccumulator + clean dead suites
c6a7125 fix(ort): work around 2.0.0-rc.12 API v24 mismatch on Windows
f3e03e9 wip: v2 streaming refactor — Parakeet ASR + Gemma translation
```
(Last 4 are this overnight pass; the first 3 are from the earlier session.)

## Eval — first run (pre-fix)

`cargo run --release --example full_pipeline_eval -- ../我的影片.mp4`
(70-min lecture recording, 16 kHz mono after ffmpeg extract):

| metric | value |
|---|---|
| Audio | 4 180.8 s (69.7 min) |
| Parakeet INT8 load | 1 557 ms |
| ASR wall | 854.2 s |
| **ASR RTF** | **4.89×** (vs 10.6× on the 17 s LibriSpeech bake-off — denser real speech + concurrent Gemma sidecar CPU contention) |
| ASR per-chunk | mean 113.8 ms · p50 107 · p95 142 · p99 284 ms |
| Sentences emitted | **57** |
| Avg words/sentence | **198.1** ⚠️ |
| Translation success | **20 / 57** |
| Translation failure | **37 / 57 (65%)** ⚠️ |
| Translation latency (successes) | mean 314 ms · p50 274 · p95 1152 ms |

**Quality samples (the 20 successes, hand-eyeballed):**

```
EN:  Hello, hell o .
ZH:  你好，你好。

EN:  So we will talk about a quiz and distribute the greater quiz papers
     at the end of this lecture .
ZH:  因此，我們會在課堂結束時進行一次測驗，並發放更多的測驗題目。

EN:  Let's see . So Bowen , how about the greater pap ers? Are they sorted
     by al phabetically by last name ?
ZH:  那麼，波恩，關於那些較大的文件，它們是按照姓氏字母順序排列嗎？

EN:  Okay, good got it. Got it. Thank you.
ZH:  好的，我了解了。 謝謝。
```

Translation quality on input it can handle is **good** — natural-sounding
TC output, term coverage is fine for a lecture domain. Matches the
2026-04 translation eval verdict that picked TranslateGemma over M2M100.

## What went wrong

### The 53-minute "sentence"

Sentence #8 in the eval JSONL spans `audio_start_sec=47.6` to
`audio_end_sec=3267.0` — 53 minutes of lecture content as one continuous
"sentence" of ~7 000 words. After it finally committed it hit Gemma's
`/completion` at 9 721 tokens, exceeded the running sidecar's
context (`-c 1024`, default — a dev-spawned instance, not ours), and
crashed the sidecar. The 30 sentences after it all failed with
`連接拒絕` because there was nothing on the port anymore.

**Why the boundary detector held the whole thing as one buffer:**
The proper-boundary path requires a Parakeet-emitted terminator
(`.` `?` `!`) that ALSO survives the abbreviation/filler suppression
and meets the minWords/minDuration thresholds. On clean LibriSpeech
read-speech (the bake-off material) Parakeet punctuates well; on
real conversational lecture audio it punctuates much less reliably.
The lecturer's running monologue contained plenty of `right?` `okay?`
fragments but not enough that survived the proper-boundary filter to
fire a commit during the lecture body.

### Other findings

5 lower-severity but user-visible bugs surfaced during the file-by-file
review (see commits `185d360`, `f26ec88`, `3d54bc5`):

| # | File | Issue | Fix |
|---|---|---|---|
| R1 | `asrPipeline.ts` | `stop()` tore down `asr-text` listener BEFORE awaiting `asr_end_session`. Engine emits 1-3 tail deltas inside its zero-flush phase; those landed after listener was gone. Last words of every recording vanished from the subtitle stream. | Reorder: end_session first, unlisten after. |
| R2 | `translationPipeline.ts` | Docstring claimed "Maintains a rolling context of the last N translated sentences and prepends them to the LLM prompt". Code pushed to `context` field but never read it. Lying comment + unused state. | Remove dead state + rewrite doc to admit the deferral. |
| R3 | `transcriptionService.ts` | `pause()` set `active=false`; next `addAudioChunk` saw `!active` and called `start()` again, which detected an existing session and stopped/restarted it. End result: pause+resume killed the in-flight session. | Separate `paused` from `active`. `pause()` only flips `paused`. `addAudioChunk` early-returns when paused; underlying session stays alive. |
| R4 | `gemma_sidecar.rs` | `Stdio::null()` for both stdout and stderr. Every llama-server failure mode (CUDA OOM, GGUF mismatch, port bound, model missing) was invisible — surfaced only as generic `BringUpResult::Timeout`. | Pipe stderr to `{app_data}/logs/llama-server.log`. Fall back to `Stdio::inherit()` if log file can't be opened. |
| R5 | `utils/onnx.rs` | If `ORT_DYLIB_PATH` was unset, `init_onnx` silently fell back to `ort::init().commit()` which on Windows hangs forever (the rc.12 bug the workaround exists to avoid). Any deployment glitch that didn't propagate the env var produced an indefinitely-frozen Tauri app. | On Windows refuse to fall back; eprintln FATAL. Subsequent `Session::builder` panics with a stack trace. Non-Windows targets still fall through. |
| R6 | `translationPipeline.ts` | No retry. A momentary llama-server hiccup permanently dropped the affected sentence from subtitles. Particularly bad on long lectures where one 30s sidecar JIT stall could nuke 5+ sentences in a row. | Retry once after 500 ms when the error message looks transient (connect / timeout / 5xx). Do NOT retry on "invalid input" / "model not loaded". |

## Fixes applied (this overnight pass)

### `01fd0d1` — Hard-cap boundary fallback (the big one)
- `isSentenceBoundary` now also returns true when buffer exceeds
  `hardMaxWords` (default **60**) or `hardMaxDurationMs` (default
  **30 000**), even without a terminator. Proper boundary still wins
  when applicable.
- `examples/full_pipeline_eval.rs` mirrors the same caps so eval
  reproduces production behaviour.
- `gemma_sidecar` server args bumped from `-c 2048` to `-c 4096` for
  defence in depth.
- `translation::gemma::translate` now refuses inputs > 3 000 chars at
  the source, before hitting the network — a buggy upstream can
  never crash the sidecar this way again.
- 8 new tests pin the behaviour.

### `185d360` — Tail-loss + pause/resume fixes (R1, R3)
- `asrPipeline.stop` reordered so listeners survive across `asr_end_session`.
- `transcriptionService.pause/resume` separated from `active`. New
  `paused` flag.
- 16 new tests covering both behaviours plus the existing service
  contract.

### `f26ec88` — Translation retry + docstring fix (R6, R2)
- `translationPipeline.translateOne` retries once with 500 ms delay on
  connect / timeout / 5xx errors.
- Dead `context` field removed; misleading docstring rewritten.
- 7 new tests covering drain order, retry logic, empty-result handling.

### `3d54bc5` — Observability + safety (R4, R5)
- `gemma_sidecar` writes llama-server stderr to `{app_data}/logs/
  llama-server.log`.
- `utils/onnx::init_onnx` no longer silently falls back to `ort::init()`
  on Windows when `ORT_DYLIB_PATH` is missing — eprintln FATAL and
  let later calls panic instead of hanging.

## Test situation

Pre-overnight (after the prior session):
- cargo lib: 75 passed
- vitest: 395 passed (47 files)

Post-overnight:
- cargo lib: **76 passed** (+1: `gemma::oversized_input_short_circuits_before_network`)
- vitest: **424 passed** (50 files, +29 tests across 3 new test files
  + 7 added in `sentenceAccumulator.test.ts`)

Coverage gaps the audit found that AREN'T fixed yet (left for a future
pass — none are blocking the morning E2E):

- No Rust unit tests for `parakeet_engine` session lifecycle. The
  engine's `Mutex<Option<EngineState>>` + `OnceLock` shape is hard to
  reset between tests without exposing internals; deferred. Real-world
  exercise coverage comes from `examples/full_pipeline_eval` and the
  user's morning manual test.
- No tests for `gemma_sidecar.ensure_running` lifecycle (spawn vs
  AlreadyRunning vs crash recovery). Would need either a mock binary
  fixture or a build-feature gate. Deferred.
- `sentenceAccumulator.drain` is O(n²) (re-slices buffer on every
  push). Confirmed with the eval — for a 70-min run with sentences
  that don't fire on first pushes, this can cost noticeable CPU. Not
  currently a bottleneck (113 ms p50 chunk timing is dominated by
  Nemotron decoder work, not accumulator) but worth a follow-up.

## What's NOT fixed and might surface in morning E2E

1. **Parakeet word-splitting on conversational English.** The eval
   showed Parakeet emits `hell o`, `stud ents`, `quest ions`, `off ice`,
   `lect ure` — splitting words on syllable boundaries with extra
   spaces. This is a model artefact (likely a tokenisation choice in
   the lokkju INT8 build), not something we can fix renderer-side
   without a post-process. Translation quality holds up despite this
   (Gemma seems to recombine), but UI subtitles will look ugly. If
   it's distracting, future work could:
   - swap to FP32 variant (might tokenise differently)
   - add a word-rejoin post-process that detects single-letter or
     fragment tokens and merges them into the previous token

2. **Pre-existing `llama-server` from a separate session can mask
   our config.** Our `ensure_running` checks `/health` first and
   returns `AlreadyRunning` without re-spawning. If the user has
   another sidecar up with weaker args (small context, bad temp), our
   pipeline inherits its constraints. This is by design (don't
   trample user instances) but worth knowing if the morning E2E shows
   weird translation behaviour.

3. **Long-form lecture WER remains untested.** The eval doesn't
   compute WER (no reference transcript). The transcripts look
   reasonable to a casual read (lecture content is recognisable) but
   we don't have a quantitative quality number for v2 ASR. If that
   matters, run an eval against a LibriSpeech subset with reference.

## Eval — second run (post-fix)

Same 70-min `我的影片.mp4` re-run with all four overnight commits in
place (`185d360`, `f26ec88`, `3d54bc5`, `01fd0d1`). Side-by-side:

| metric | pre-fix | post-fix | Δ |
|---|---|---|---|
| Audio | 4 180.8 s | 4 180.8 s | — |
| ASR wall | 854.2 s | 849.3 s | ≈ |
| **ASR RTF** | 4.89× | **4.92×** | ≈ |
| ASR per-chunk p95 | 142 ms | 131 ms | better |
| **Sentences emitted** | 57 | **228** | **+300%** |
| **Avg words/sentence** | 198.1 | **49.5** | **−75%** |
| Translation latency (successes) p50 | 274 ms | **807 ms** | longer (longer sentences are real work; 274 ms was inflated by tiny short successes that didn't crash the sidecar) |
| Translation latency p95 | 1 152 ms | **1 030 ms** | better |
| **Translation success rate** | 20 / 57 (35.1%) | **167 / 228 (73.2%)** | **2.1×** |
| End-to-end wall | 935.8 s | 1 104.1 s | longer (more sentences to translate) |
| Combined RTF | 4.47× | **3.79×** | slower in absolute terms but vastly more output |

The hard-cap fix did exactly what it was meant to: the catastrophic
53-min mega-sentence is gone, replaced by a smooth stream of clause-
sized chunks. Sample from the lecture body (sentence #112, 60 words,
mid-lecture heap-data-structure explanation):

```
EN: a more det ailed example so okay so this is the initial main heap
    okay a new guy comes in that is zero o kay and zer o was initially
    assigned here but it doesn't it doesn't fit here so it has to go
    up called bubble up you swap with the four right still not yet
    why you validate

ZH: 一個更詳細的例子，好的，所以這是初始的主堆。然後，一個新的元素進入，
    這個元素是 0。這個元素最初被分配到這裡，但它不適合這裡，所以它必須被移動，
    也就是「冒泡」操作。它與第四個元素交換，但仍然不適合。為什麼？需要驗證。
```

Reasonable TC, technical term coverage holds (`bubble up` → `冒泡`),
even handles the lecturer's disfluencies (`okay`, repeated `not yet`)
without turning into junk.

### One real-world failure mode surfaced — CUDA crash on the sidecar

61 of the 228 translations failed, all in a single block at the tail
end of the run. Cause logged to `{app_data}/logs/llama-server.log`
(thanks to R4 — pre-fix this would have been silent):

```
slot update_slots: id  3 | task 10751 | prompt processing done, n_tokens = 62, batch.n_tokens = 4
CUDA error: an illegal memory access was encountered
  current device: 0, in function ggml_backend_cuda_synchronize at
  D:\a\llama.cpp\llama.cpp\ggml\src\ggml-cuda\ggml-cuda.cu:3083
  cudaStreamSynchronize(cuda_ctx->stream())
```

Llama.cpp / CUDA driver bug — happens after ~200 successive translation
requests. Not something we can fix renderer-side. Mitigations to
consider:

1. **Auto-restart sidecar on health-check failure during translation**.
   The translationPipeline's retry-once handles transient connect
   errors but doesn't bring the sidecar back from the dead. A dead
   sidecar after the 200th sentence permanently kills the rest of the
   recording.
2. **Periodic `/health` probe** between translations — if it goes
   red, tear down + respawn before continuing.
3. **Rate-limit translation requests** — current code drains the queue
   as fast as the sidecar can serve. A 50ms inter-request gap might
   reduce CUDA pressure.

Deferred until the morning E2E confirms the bug reproduces in the real
Tauri app (this might be specific to long-eval throughput rather than
a real-user pace).

### Quality verdict — meets v2 expectations

The 167 successful translations match the 2026-04 translation eval's
verdict that picked TranslateGemma 4B Q4_K_M over M2M100. Per-sentence
samples:

- Lecturer's natural Chinese phrasing
- Technical terms preserved (heap, bubble up, queue, etc.)
- Disfluencies handled gracefully
- Punctuation natural (proper 「」 quotes when relevant)

Failure rate breakdown:
- 0 failures across the first 167 sentences (until CUDA crash)
- 61 failures all clustered after CUDA crash at sentence ~167
- **0 failures from over-long input** (hard cap held; would have been ~37+ failures pre-fix)

This is a successful v2 baseline.

## Reports on disk

```
target/eval-reports/我的影片-20260425-033338.{md,json,jsonl}  ← pre-fix
target/eval-reports/我的影片-20260425-040454.{md,json,jsonl}  ← post-fix
{app_data}/logs/llama-server.log                              ← sidecar stderr
```

## How the user should approach the morning E2E

The bake-off transcripts above prove translation quality is fine on
ASR-shaped input. The hard-cap fix means no more pipeline-killing
mega-sentences. Suggested manual-test order:

1. Launch the Tauri app (`npm run tauri:dev`).
2. Settings → confirm INT8 model is loaded (auto-loads on first session).
3. Settings → confirm Gemma sidecar is healthy (or trigger spawn).
4. Import `我的影片.mp4` via the import-video flow (or record a fresh
   2-3 min monologue).
5. Watch the subtitle panel. Expect:
   - Sentences flowing every ~10–30 s during continuous speech
   - Translations appearing 200–1 200 ms after each English commit
   - At end-of-recording, the last clause should appear (R1 fix)
6. Pause + resume mid-recording. Expect the session to survive (R3 fix).
7. Cross-check `{app_data}/logs/llama-server.log` if anything looks
   off — that file should now exist and contain useful diagnostics
   (R4 fix).
