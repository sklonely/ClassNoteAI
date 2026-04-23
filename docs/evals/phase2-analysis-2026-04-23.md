# Phase 2 evaluation — energy VAD vs Silero VAD v5

**Date**: 2026-04-23
**Harness**: `ClassNoteAI/src-tauri/examples/phase2_vad_eval.rs`
**Raw report**: [`phase2-vad-comparison-2026-04-23.md`](phase2-vad-comparison-2026-04-23.md)
**Scope**: Phase 2 of [speech-pipeline-v0.6.5](../design/speech-pipeline-v0.6.5.md) — #55

## Setup

Same audio (`我的影片.mp4`, 90 s mid-lecture clip — CS lecture on DFS/BFS tree traversals) → two VAD backends → Whisper base transcription of each VAD's segments → side-by-side subtitle comparison.

| VAD | Implementation |
|---|---|
| Energy (current) | `classnoteai_lib::vad::VadDetector` — RMS-threshold, 100 ms windows, hysteresis, merges short silences |
| Silero v5 (candidate) | Official ONNX model via `ort` 2.0.0-rc.11 with `load-dynamic` DLL |

Silero v5 model: `silero_vad.onnx` from `snakers4/silero-vad` master branch. Runs on CPU, 512-sample chunks at 16 kHz with a 64-sample context prepended (required — without it probabilities collapse to ~0).

## Aggregate metrics

| Metric | Energy VAD | Silero v5 |
|---|---|---|
| Segments detected | 9 | **11** |
| Total speech time | 71.0 s (78.9%) | **74.5 s (82.8%)** |
| Mean segment length | 7889 ms | 6772 ms |
| Detection time | 1 ms | 472 ms |

Silero runs at ~190× realtime on CPU — **well within the streaming budget** (TRANSCRIPTION_INTERVAL_MS=800). The 471 ms delta isn't a latency concern.

## Timeline (1 cell = 500 ms, total 90 s)

```
Energy: .###################################################.#####################.........######.......############...######################..#############......####################..####
Silero: ##########################################################################...##....######.##....###########..#..######################.#############......##########################
        0s                  10s                 20s                 30s                 40s                 50s                 60s                 70s                 80s
```

Both VADs agree on the bulk of speech. Silero:
- Extends further at speech onset (`0.1 s` vs Energy `0.7 s` — catches the leading word).
- Catches short utterances in the 38–55 s Q&A region that Energy misses entirely.
- Trims the tail at 85 s cleanly (Energy runs on to 87 s into disfluent cutoff).

## Per-segment qualitative comparison

Reading the two subtitle streams end-to-end:

### What Silero catches that Energy misses

| When | Content | Energy VAD | Silero |
|---|---|---|---|
| 38.9–39.4 s (500 ms) | Professor's "Anybody?" question to the class | **dropped** | seg 3 |
| 45.1–45.8 s (700 ms) | Student name acknowledgment "Yeah Calvin" (Whisper heard "Eherkabel") | **dropped** | seg 5 |
| 54.6–54.9 s (300 ms) | Fragment "here." | **dropped** | seg 7 |
| 0.1–0.7 s (600 ms lead-in) | Leading "two, and you just start..." | **leading word dropped** | seg 1 start |

Two of these are genuine speech with semantic value (the "Anybody?" question marks a Q&A turn; the student name flags a speaker change). Phase 8 diarization would benefit from these being captured. The "here." fragment is less critical but not noise.

### Where Silero groups better (more translation context per chunk)

Energy splits the transcript at 20.9 s → 25.9 s → 26.8 s:

> seg 2: "BST is a linear chain, which is a special case of a tree. Now,"
> seg 3: "What kind of traversals? Because we did a lot of traversals..."

Silero merges these into one 16.1 s block. The merged block gives M2M100 the full "linear chain → Now, what kind of traversals" context, which Phase 5's rolling window will leverage even more. Energy's split drops the "Now," onto a lonely word boundary.

### Where Silero trims tails cleaner

Energy seg 8 ends at 87.0 s with a disfluent cutoff:
> "Because the computer actually doesn't understand recursion at all right if you talk to the computer a machine language assembly language There's no no no recursion at all recursion is only added"

Silero seg 10 ends at 85.2 s at a clean period:
> "because the computer actually doesn't understand recursion at all, right? If you talk to the computer in machine language, assembly language, there's no recursion at all."

Then Silero seg 11 picks up from 85.8 s with "Recursion is only added in a high level program..." — a natural sentence break.

## Verdict

**Silero VAD v5 produces measurably cleaner subtitle boundaries** on this real lecture clip:

- **+3.9% speech coverage** (82.8% vs 78.9%) — 3 short utterances recovered
- **Cleaner sentence-end boundaries** — tails trimmed at periods, not mid-disfluency
- **Better translation-context grouping** — related clauses merged instead of split on artificial pause boundaries
- **190× realtime** — fast enough for streaming, not a bottleneck

One caveat: Silero produces a couple of very short segments (300–700 ms) that Energy's 1000 ms minimum filters out. For live captions, we may want to raise Silero's MIN_SPEECH_MS from 250 to 500 to match Energy's conservatism — at the cost of dropping the "Anybody?" type utterances. This is a tunable, not a fundamental limitation.

## Integration cost findings (infrastructure)

While writing this harness I hit three concrete integration hurdles that Phase 2 proper will have to solve:

1. **ONNX Runtime DLL version mismatch**. `ort = "2.0.0-rc.11"` requires `onnxruntime.dll >= 1.23.x`, but Windows boxes commonly have older DLLs (1.17.1 shipped with Office/Edge/etc.) on PATH, which take precedence under `load-dynamic`. The eval required setting `ORT_DYLIB_PATH` explicitly. In production we'll need to bundle a pinned onnxruntime.dll next to the app binary and load it unconditionally — same approach the `whisper-rs` side already uses for its native deps.

2. **`ndarray` version collision**. The lib has `ndarray = "0.15"`, but `ort` 2.0.0-rc.11 pins `ndarray = "0.17"` transitively. The generic `Tensor::from_array(impl OwnedTensorArrayData<T>)` bound fails when the two ndarrays coexist. Workaround for the harness: pass `(Vec<usize>, Vec<T>)` shape+data tuples instead of ndarray arrays. For production: either upgrade the lib to `ndarray = "0.17"` (touches embedding/Whisper paths) or keep the "raw tuples" approach in the VAD wrapper alone.

3. **Model input shape**. The Silero v5 model does **not** take `[1, 512]` alone — it takes `[1, 64 + 512]` with the previous frame's trailing 64 samples prepended as `CONTEXT`. Without the context the probabilities collapse to ~0.001 and nothing is ever detected. This is subtle and not documented in the snakers4 README; the official Rust example in the same repo carries the context explicitly. Production implementation must do the same.

These are tractable; they align with the risk register in the v0.6.5 design doc.

## Implications for the plan

| Item | Signal |
|---|---|
| Phase 2 **is worth doing** | The VAD improvement is measurable and user-visible on real lecture content. |
| Phase 2 integration is **more involved than the plan estimated** | 3 infra hurdles above need first-class solutions, not bandaids. Estimate ~2–3 days of plumbing before any production code ships. |
| **Short-utterance capture enables #57 (diarization)** | The "Anybody?" and student-response turns Silero recovers are exactly where speaker diarization gets useful. Energy VAD's min-duration filter was silently bottlenecking that feature. |
| MIN_SPEECH_MS tuning | For v0.6.5 initial ship, set Silero MIN_SPEECH_MS=500 for conservatism. Phase 8 can relax it once diarization can route sub-second utterances into speaker turns. |

## Reproducing

From `ClassNoteAI/src-tauri`:

```bash
# One-time setup:
mkdir -p /tmp/silero /tmp/ort
curl -sSfL -o /tmp/silero/silero_vad.onnx \
  "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
curl -sSfL -o /tmp/ort/onnxruntime.zip \
  "https://github.com/microsoft/onnxruntime/releases/download/v1.23.0/onnxruntime-win-x64-1.23.0.zip"
unzip -q /tmp/ort/onnxruntime.zip -d /tmp/ort/

# Build + run:
cargo build --release --example phase2_vad_eval

ORT_DYLIB_PATH="C:/Users/asd19/AppData/Local/Temp/ort/onnxruntime-win-x64-1.23.0/lib/onnxruntime.dll" \
SILERO_VAD_ONNX="C:/Users/asd19/AppData/Local/Temp/silero/silero_vad.onnx" \
./target/release/examples/phase2_vad_eval.exe /path/to/lecture.wav
```

On macOS/Linux the DLL suffixes differ (.dylib / .so) but the env var mechanism is the same.

## Summary

Silero VAD v5 is a clear quality win on real lecture audio — catches 3 short utterances the current energy VAD drops, groups related speech into longer context windows for better downstream translation, trims tails at clean sentence boundaries. CPU inference is 190× realtime so latency is a non-issue.

The integration hurdles (DLL version, ndarray conflict, required CONTEXT window) are non-trivial but well-understood now. Phase 2 proper is green-lit; the estimated cost is higher than the plan originally budgeted (2–3 days of plumbing before user-visible output), but the payoff is real and cascades into Phases 3/4/5/8.
