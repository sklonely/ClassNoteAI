# Phase 0 evaluation — analysis

**Date**: 2026-04-23
**Harness**: `ClassNoteAI/src-tauri/examples/phase0_translation_eval.rs`
**Raw report**: [`phase0-translation-ab-2026-04-23.md`](phase0-translation-ab-2026-04-23.md)
**Scope**: Phase 0 of [speech-pipeline-v0.6.5](../design/speech-pipeline-v0.6.5.md), PR #121

## What was compared

Same M2M100 model (`m2m100-418M-ct2-int8`), same inputs, two configurations:

| Aspect | Baseline | Phase 0 |
|---|---|---|
| `TranslationOptions::repetition_penalty` | `1.0` (no penalty) | `1.3` |
| `TranslationOptions::no_repeat_ngram_size` | `0` (no ban) | `4` |
| `clean_translation` post-process | strip `__xx__` + strip leading non-CJK | above + `collapse_repetitions` |

Everything else (beam_size=4, patience=1.0, max_decoding_length=256) identical.

Three evaluation tiers:
1. **Text fixtures** — deliberately-chosen inputs reproducing #67, plus controls.
2. **Whole-transcript audio** — a single long M2M100 call on a 1281-char transcript from 90 s of lecture. Surfaces M2M100's input-length limits.
3. **Per-sentence audio** — what the streaming app actually does: split the Whisper transcript on sentence-ending punctuation, run A/B on each chunk. This is the most representative tier.

## Tier 1 — text fixtures

Five hand-crafted inputs: two reproducing the exact #67 failure text, two controls, one edge case.

| Fixture | Baseline | Phase 0 | Verdict |
|---|---|---|---|
| `issue-67-example-1` (3-sentence disfluent English) | `系统状态障碍,不是吗?` (1 of 3 sentences) | `系统状态障碍,你不是吗?` (1 of 3 sentences) | **Not fixed.** Root cause is context collapse, not repetition; decoder params cannot recover dropped sentences. Phase 5 (rolling context + LA-2) is the right fix. |
| `issue-67-example-2` (filler-heavy 230 chars) | `我认为,` × 26 (pathological loop) | `我认为,在我的观点中,我发现你知道,发送Heuristic所有钥匙在这里,跟随并理解,也许因为,你知道,它没有严格的,包容性,注意力类型,它是更普遍的,任何百分比。` | **Major fix.** Loop eliminated; semantic content mostly preserved. |
| `control-clean-academic` | `格拉迪安下降算法是用来优化机器学习模型的损失功能。` | *identical* | **No regression.** |
| `control-enumeration` | `神经网络, and evaluation metrics. 此讲座将涵盖三个关键主题:监督学习,神经网络,和评估测量。` (English leakage + repeat) | `本讲座将涵盖三个关键主题:监督学习,神经网络和评估测量。` | **Bonus improvement.** The n-gram ban interrupts M2M100's "echo source before translate" prefix. |
| `disfluent-short` (49 chars, all fillers) | `所以, um,基本上,你知道,它喜欢,哦,是的。` | `。` | **New regression.** `no_repeat_ngram_size=4` left M2M100 no path through 7 consecutive fillers; the decoder emitted `。` repeatedly and `collapse_repetitions` reduced to one. Phase 4's minimum-word-count threshold will prevent such fragments from ever reaching translation. |

## Tier 2 — whole-transcript audio

90-second CS-lecture clip (DFS/BFS tree traversals) → Whisper (base model, detected en with p=0.999) → 1281-char transcript → single M2M100 call.

**Result**: both configurations **fail to produce Chinese**, but fail differently:

- Baseline (723 chars): echoes the English source, then loops (`But we already did kind of just count traversals on trees…` appears twice).
- Phase 0 (692 chars): echoes the English source, with slight word variations, no loop.

Neither path hits Chinese within the 256-token decoder budget — M2M100-418M simply isn't built for 1281-char technical inputs. Phase 0's decode guards **reduce the symptom severity** (no loop) but cannot rescue what is fundamentally an input-length failure.

**Takeaway**: the whole-transcript call is not how the streaming app operates, but the result is pedagogically useful — it shows the upper bound of what decode-time guards can do.

## Tier 3 — per-sentence audio (the streaming-app shape)

Same transcript split on sentence-ending punctuation into 20 segments, each translated independently.

| Metric | Baseline | Phase 0 |
|---|---|---|
| **Segments with any CJK output** | 18 / 20 (90%) | **20 / 20 (100%)** |
| **Total wall time** | 175.2 s | **161.7 s** (faster) |
| **Detectable loop pathology** | Seg 9 (`是谁?×3`), seg 13 (source-echo×3), seg 17 (`為什麼?×2`), seg 20 (source-echo×3) | Seg 17 (`為什麼?×2`) only |

Two segments that baseline **could not translate at all**, Phase 0 handled cleanly:

- **Seg 13**: "There are other depth for search traversals here."
  - Baseline: `There are other depth for search traversals here. _en__ There are other depth for search traversals here. _en__ ...` (full English loop, `_en__` token leak)
  - Phase 0: `在这里有其他深度搜索通道。` ✅
- **Seg 20**: "Recursion is only added in high-level programming, it's just like, see."
  - Baseline: full English loop × 3 with `_en__` leaks
  - Phase 0: `高级编程, it's just like, see.` (partial Chinese — imperfect but usable)

Other wins:
- Seg 9 "Anybody?": baseline `是谁?是谁?是谁?` → Phase 0 `是的,任何人?` (repetition eliminated)

**Residual failures Phase 0 does not catch** (by design):
- Seg 17 "Why?" → both sides emit `為什麼?為什麼?` (2 repeats stay below the collapse threshold of 4; tightening would risk legitimate repetition like "好，好。")
- Seg 18 "Because the computer actually doesn't understand recursion at all, right?" → both sides emit `对吗?` only (10% of the meaning) — a context-collapse failure like `issue-67-example-1`, Phase 5 territory.

## What the experiment proves

### Phase 0 works where it claimed to

- ✅ Kills the **headline #67 repetition loop** (`我认为×26`).
- ✅ Lifts **real-world lecture end-to-end Chinese coverage** from 90% to 100% of segments.
- ✅ Produces **slightly faster** decoding, because the n-gram ban cuts off failing beam-search paths earlier.
- ✅ **No regression on clean text.**
- ✅ **Bonus**: interrupts M2M100's "echo source before translate" prefix on enumerations and long sentences.

### Phase 0 does not fix what it was never going to fix

- ❌ Multi-sentence context collapse (`issue-67-example-1`, seg 18) — needs Phase 5.
- ❌ Input-length failure on 1000+ char blocks — M2M100-418M limit; only mitigated by chunking.
- ❌ Model-level technical-term quality (traversals → 通道, recursion → 回归, stack → 站点, in-order → 在订单中) — M2M100-418M isn't built for CS/STEM lectures; future work involves model swap (MADLAD-400, cloud LLM refinement).
- ⚠️ 2-repeat short patterns (`為什麼?為什麼?`) — tightening the collapse threshold would risk legitimate repetition.
- ⚠️ Pure-filler short inputs collapse to `。` — operationally handled by Phase 4's chunk-size floor.

## What this tells us for the plan

| Next phase | Reinforced? Revised? |
|---|---|
| **Phase 3** (#53 hallucination guards) | **Reinforced.** Add output-length sanity: translated chars < 0.05 × input chars → low-confidence. Would cleanly flag `disfluent-short` collapse AND seg 18's 10% output. |
| **Phase 4** (#71 smart segmentation) | **Reinforced.** Minimum-word-count threshold before a chunk is eligible for translation eliminates `disfluent-short` entirely. |
| **Phase 5** (#58 rolling context + LA-2) | **Sharpened.** Today's data confirms `issue-67-example-1` and lecture seg 18 both need 3-segment rolling window. Not just about stability — it's about keeping context so M2M100 stops dropping sentences. |
| **Phase 5 addition** | Add fallback: if Phase 0 decoding produces output-ratio < 0.1 or no CJK at all, retry with weaker guards (`no_repeat_ngram_size=2`). Aligned with seg 18's failure. |
| **Future (post-v0.6.5)** | Model swap evaluation: MADLAD-400 on STEM content vs M2M100. Or LLM-backed fine-translation on post-lecture batch. Both tangential to Phase 0, but today's STEM vocabulary failures suggest M2M100-418M alone is the real ceiling. |

## Reproducing

From repo root:

```bash
cd ClassNoteAI/src-tauri

# Text fixtures only:
cargo run --release --example phase0_translation_eval

# Fixtures + end-to-end audio (whole-transcript + per-sentence A/B):
cargo run --release --example phase0_translation_eval -- /path/to/lecture.wav

# Multiple audio files:
cargo run --release --example phase0_translation_eval -- clip1.wav clip2.wav
```

Defaults to `%APPDATA%\com.classnoteai\models\translation\m2m100-418M-ct2-int8` and
`%APPDATA%\com.classnoteai\models\whisper\ggml-base.bin`. Override with
`M2M100_DIR=` and `WHISPER_MODEL=` env vars.

Extract audio from an mp4 with:
```bash
ffmpeg -i lecture.mp4 -ac 1 -ar 48000 -c:a pcm_s16le lecture.wav
```

## Summary

Phase 0 is **measurably net positive**:

- Per-sentence lecture end-to-end: **10 percentage points improvement** in Chinese segment coverage (90% → 100%), plus visible quality wins on short repetition patterns.
- Known #67 headline bug (`我认为×26`) is gone.
- Controls unchanged; no regression on clean inputs.
- One edge case (pure-filler short inputs) produces empty output; operationally mitigated by Phase 4's chunk-size floor.
- **The bigger translation quality ceiling is M2M100-418M's capacity on long/technical inputs** — Phase 0 exposes that limit without being able to lift it. That ceiling is what Phase 5 (rolling context) and future model-swap work address.

The eval harness stays in-tree as a reproducible regression-guard artifact: any future change to `ctranslate2.rs` options or `clean_translation` can be re-benchmarked in ~3 minutes for text fixtures, ~6 minutes including 90 s of real audio.
