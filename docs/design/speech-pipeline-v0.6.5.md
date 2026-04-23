# Speech Pipeline v0.6.5 — Overhaul Plan

**Status**: Draft (2026-04-22)
**Scope**: Consolidates issues #67, #71, #74 (epic), #57, #55, #53, #56, #58, #62, #52, #54, #59
**Owner**: TBD when sprint opens

---

## 1. Background

Three independent failure modes are biting users today:

1. **#71 — Over-aggressive sentence splitting** — punctuation regex + 2.4s silence threshold cuts mid-sentence on natural pauses, fragmenting translation context.
2. **#67 — Translation collapse** — M2M100 with `repetition_penalty: 1.0` and `no_repeat_ngram_size: 0` produces "我认为×26" loops; cross-chunk context is also lost (no rolling window).
3. **#74 epic** — owner already noted that fixing these in isolation rebreaks the others; needs coordinated redesign with VAD upgrade (#55), hallucination guards (#53), code-switching (#56), and diarization (#57).

This document captures the unified plan agreed before sprint open.

---

## 2. User scenarios driving the design

ClassNoteAI users are Taiwanese university students recording lectures. The design pivots on these realities:

| Dimension | Distribution | Implication |
|---|---|---|
| Hardware | MacBook M-series ~60% / Windows laptop ~40% | Must run on pure CPU; no required discrete GPU |
| RAM | 8–16 GB common | No unbounded buffers |
| Mic | Built-in ~70% / AirPods ~25% / external ~5% | Robust to far-field + noise |
| Lecture lang | Pure-zh / pure-en / **code-switched (most common in EMI)** | Single-language locking breaks 1/3 of users |
| Length | 50/75 min typical, 3 hr seminar | No leaks; recoverable on crash |
| Environment | Lecture hall / classroom / online Zoom | Adaptive without explicit calibration UI |
| Speaker mix | Prof monologue 70% / Q&A 20% / discussion 10% | Multi-speaker must not jumble |

### Failure mode → scenario mapping (drives priority)

| Scenario | Today's failure | Pain | Issue |
|---|---|---|---|
| EMI 90-min, built-in mic | "我认为×26" repetition | **immediate uninstall** | #67 |
| EMI 90-min, built-in mic | "Thank you for watching" hallucination | high | #53 |
| Any length, 2.5s thinking pause | Sentence cut mid-clause | high (every lecture) | #71 |
| Code-switched ML/CS | One language correct, other garbled | **every class breaks** | #56 |
| Q&A / discussion | Student speech mixed into prof transcript | medium | #57 |
| 3 hr seminar | OOM / slowdown / lag accumulation | medium | #62 |
| Any length, on crash | **All audio lost** | **catastrophic — trust → 0** | #52 |
| STEM | Formulas as prose, code as paragraphs | medium (specific cohort) | #59 |

---

## 3. Target architecture: `SpeechPipeline` in Rust

Today: `TranscriptionService.ts` (frontend) makes VAD/chunking decisions, calls Rust for Whisper, then `translationService.ts` calls Rust for M2M100. Decision logic scattered across the IPC boundary makes it untestable and hard to evolve.

Target: a single Rust state machine owns everything from audio frames to committed segments. Frontend subscribes to events and renders.

```
Audio I/O ─► AudioGate ─► Silero VAD v5 ─► (Optional) LID/Diarize ─► Target Selector
                                                                          │
                                                                          ▼
                                                                  Whisper Decoder
                                                              (with halluc guards)
                                                                          │
                                                                          ▼
                                                              LocalAgreement-2 Commit
                                                                          │
                                                                          ▼
                                                               Sentence Boundary
                                                          (logprob+speaker+semantic+len)
                                                                          │
                                                                          ▼
                                                            Glossary Substitution
                                                                          │
                                                                          ▼
                                                          Streaming Translation
                                                       (M2M100 + 3-seg rolling ctx
                                                          + repetition guards)
                                                                          │
                                                                          ▼
                                                       Persist (sqlite + WAV chunks)
                                                                          │
                                                                          ▼ Tauri events
Frontend: subscribe-only — LiveCaption / TimelineView / PostLectureView
```

Key principles:
- **One state machine, one owner** — all chunking/commit/context decisions in one Rust struct, fully unit-testable, fixture-replayable.
- **Frontend is a renderer**, not a decision-maker.
- **Persistence first** — crash recovery is a precondition for trusting any other improvement.

---

## 4. Phased delivery — every phase independently shippable

### Phase 0 — Emergency stabilization (~1 day, 1 PR)
Issues: #67 (acute), #71 (palliative)

| Change | File | LOC | Effect |
|---|---|---|---|
| `repetition_penalty: 1.3`, `no_repeat_ngram_size: 4` | `ctranslate2.rs` | 2 | Kills "我认为×26" at decode time |
| `collapse_repetitions()` post-process | `ctranslate2.rs` | ~30 | Defense-in-depth net |
| Silence commit threshold 3 → 4 ticks | `transcriptionService.ts` | 1 | Less mid-sentence cutting on natural pauses |
| Filler-word-aware sentence end (`um.`, `you know.` not committable) | `transcriptionService.ts` | ~10 | Reduce false sentence boundaries |

**Acceptance**: #67 lossless fixture no longer produces repetition; mid-sentence cuts measurably reduced.

### Phase 1 — Crash recovery foundation (~3 days, 1 PR)
Issue: #52

Without this, every later improvement risks "user lost their lecture" overshadowing it.

- Streaming WAV append-only write, flush every 10s
- Append-only transcript JSONL per segment
- App boot scans for orphan sessions → recovery dialog
- Battery-aware: < 10% warn, < 5% auto-stop+flush

**Acceptance**: kill -9 mid-recording → restart can recover; 3 hr simulated session has no data loss.

### Phase 2 — Silero VAD v5 (~3 days, 1 PR)
Issue: #55 — foundation for #71/#53/#56/#57

- Add `ort` crate (ONNX Runtime) bindings
- Bundle Silero v5 ONNX (~2 MB) in `src-tauri/resources/`
- Rewrite `vad/mod.rs`, keep `SpeechSegment` API for backward compat
- Hysteresis (start: N consecutive frames > thr; stop: M frames < thr); 200 ms padding both sides
- Keep hidden state across chunks — write a fixture test that `process_one_pass(audio)` == `concat(process_chunked(audio))`

v5 is 3× faster (TorchScript) / 10% faster (ONNX) than v4, accuracy 0.96 vs 0.89, model 2 MB vs 1 MB. v5 introduces context passing — must preserve hidden state at chunk boundaries.

**Acceptance**: classroom-noise fixture, false-trigger rate down > 70%.

### Phase 3 — Hallucination guards (~2 days, 1 PR)
Issue: #53

With cleaner VAD chunks, layer Whisper guards:

- Read `avg_logprob` and `compression_ratio` from segment metadata
- Drop segment if `avg_logprob < -1.0` OR `compression_ratio > 2.4` (Whisper-recommended)
- N-gram (n=3..5) detector: ≥3 consecutive repeats → truncate
- Blacklist: `["thank you for watching", "请订阅", "字幕组", ...]` exact-match drop
- Silence-suppression: VAD-marked non-speech chunks bypass decode entirely

**Acceptance**: classroom-silence fixture produces no "Thank you for watching".

### Phase 4 — Smart segmentation (~4 days, 1 PR)
Issue: #71

Replace punctuation regex with multi-signal weighted decision:

```rust
fn should_commit_at(seg: &Segment, ctx: &Ctx) -> bool {
    let signals = [
        seg.ends_with_strong_punct(),
        seg.confidence > 0.85,
        seg.word_count >= 5,
        ctx.silence_after_ms >= 1500,
        ctx.speaker_changed,            // Phase 8 wire-up
        ctx.semantic_complete,          // optional LM probe
    ];
    signals.iter().filter(|x| **x).count() >= 3
}
```

Plus: hold even at sentence boundary while buffer < 70% (gather more context); filler-word endings never committable.

**Acceptance**: #67 fixture, sentence-boundary alignment vs ground truth improves > 50% over baseline.

### Phase 5 — Translation rolling context + LA-2 (~4 days, 1 PR)
Issues: #58 (core), #67 (structural fix)

The real #67 fix, not the Phase 0 bandaid.

- New `translation/streaming.rs` with 3-segment rolling window: `[prev_prev, prev, current]` → M2M100, output sliced to current
- LocalAgreement-2 commit: prefix-match between consecutive partials; matched prefix = confirmed (solid caption), tail = provisional (faded caption)
- Glossary placeholder substitution scaffolding (people/term names → preserve original)
- Cache key unchanged (per-text); context-augmented translations bypass cache

References: [whisper_streaming](https://github.com/ufal/whisper_streaming) (Macháček 2023, LA-2 reference impl, 3.3 s p95 latency); [WhisperLiveKit LocalAgreement backend](https://deepwiki.com/QuentinFuxa/WhisperLiveKit/3.2-localagreement-backend) (production reference).

**Acceptance**: #67 example-1 scenario (3 sentences → independently translated, 2 lost) produces 3 complete output sentences; caption rewrite-rate p95 < 1 per sentence.

### Phase 6 — Code-switching support (~5 days, 1 PR)
Issue: #56

- Settings: `course.language_profile` = `{ primary, secondary[], mode: locked|hybrid }`
- Per-VAD-segment LID (lightweight CPU model, few-ms inference)
- LID confidence > 0.85 → lock Whisper to that language; otherwise PromptingWhisper dual-token initial prompt
- Per-course glossary feeds Whisper `initial_prompt` (mind 224-token cap)

References: [PromptingWhisper (arXiv 2311.17382)](https://arxiv.org/abs/2311.17382) for SEAME zh/en CS; [Encoding Refining + Language-Aware Decoding (arXiv 2412.16507)](https://arxiv.org/html/2412.16507v2) as later research direction.

**Acceptance**: "So this is gradient descent，就是梯度下降" both halves correctly recognized.

### Phase 7 — Long-session safety (~3 days, 1 PR)
Issue: #62 — builds on Phase 1

- WAV chunked file split (one file per 10 min); UI queries to reconstruct timeline
- Rolling memory: only last 5 min transcript in RAM, older flushed to sqlite
- Whisper queue backpressure: queue depth > 30s → degrade large-v3 → turbo, tiny corner indicator
- Auto-stop policies: low battery, overheat, forget-mode (4 hr without user activity)

**Acceptance**: 3 hr continuous recording memory stays flat; force-killed app can recover.

### Phase 8 — Diarization + AudioTrack (multi-PR epic, ~3 weeks)
Issue: #57 — heaviest piece, defer to its own milestone (v0.7)

- Layer 1: TSE / dominant-cluster (lock professor) → live caption gating
- Layer 2: full diarization (pyannote 3.1 ONNX or NeMo Sortformer) → background transcript
- Layer 3: babble + near-field detection → discussion mode
- AudioTrack schema: `{ speaker_id, confidence, is_target }` per segment
- Live UI distinguishes professor vs others

**Acceptance**: see #57's 7 sub-criteria.

### Phase 9 — Post-lecture LLM cleanup (~3 days, 1 PR)
Issue: #59 — batch job, no impact on live path

- Slide OCR injection (user uploads PDF/PPT → extract formulas/vars → inject into Whisper `initial_prompt`)
- LLM post-processing: spoken formula → LaTeX, code → fenced block, Greek words → symbols
- Original transcript preserved as source of truth

---

## 5. Tech selections + rejected alternatives

| Pick | Rationale | Rejected option (why) |
|---|---|---|
| **Whisper-large-v3** stays | Still strongest open ASR for zh/en code-switching | Parakeet V3 (fast but weak Chinese); Canary (no zh/en CS) |
| **Silero VAD v5** | 2 MB ONNX, < 1 ms CPU, 6000+ langs, 0.96 vs 0.89 quality | WebRTC VAD (legacy); Cobra (commercial license) |
| **M2M100** stays (short-term) | Apache, deployed, Phase 0 + Phase 5 changes make it sufficient | NLLB-200 (better quality, **CC-BY-NC blocks commercial — blocker**); MADLAD-400 (evaluate post-Phase 5) |
| **LocalAgreement-2** for streaming | Simple, proven, `whisper_streaming` 3.3s p95 verified | Wait-k (fixed latency, worse quality); MMA (training complexity) |
| **pyannote 3.x ONNX** for diarization | Privacy-preserving, mature open-source | NeMo Sortformer (newer, Rust integration immature) |
| Translation NOT routed to cloud LLM | Privacy, cost, offline-first | Reserve cloud LLM for #59 fine-refinement only |

---

## 6. Acceptance: regression fixture set

Build `evals/speech-pipeline/` from #67 owner-supplied lossless package + new captures:

| Fixture | Content |
|---|---|
| `pure-en-lecture-90min.wav` | EMI English monologue |
| `pure-zh-lecture-50min.wav` | Mandarin lecture |
| `code-switched-ml.wav` | zh/en mixed ML class |
| `stem-physics.wav` | Formula-dense |
| `discussion-3speakers.wav` | Multi-speaker Q&A |
| `noisy-classroom.wav` | Noise baseline |

Per-fixture metrics:
- WER (per chunk + overall)
- Translation chrF / BLEU vs reference
- Caption rewrite-rate
- End-to-end p50 / p95 latency (utterance → on-screen)
- RAM / CPU at 60-min mark
- Hallucination rate (per minute)

CI runs subset; > 5% regression auto-fails.

---

## 7. Risk register

| Risk | Mitigation |
|---|---|
| ONNX Runtime missing on Windows | `ort` crate `download-binaries` feature; static-link |
| Silero v5 hidden-state corruption at chunk seams | Unit fixture: `one_pass(audio) == concat(chunked(audio))` byte-for-byte tolerance |
| LA-2 + 3-seg context exceeds 3s latency budget | Budget guard with emergency-path fallback (no context) |
| pyannote CPU cost on 8 GB Intel laptops | Diarization opt-in; lightweight fallback heuristic |
| MADLAD-400 quantization missing Metal backend on M-series | Evaluate-only, do not block main path |
| Multi-Phase PR conflicts | Strict sequential merge; trunk-based short branches per project convention |

---

## 8. Out-of-scope for v0.6.5

- iOS companion (#64)
- System audio capture for Zoom/Teams/Meet (#60) — separate stream
- Settings UI redesign (#48) — orthogonal
- HTTP client unification (#50) — orthogonal infra

---

## 9. References

- [Silero VAD GitHub](https://github.com/snakers4/silero-vad) and [v4 vs v5 quality metrics](https://github.com/snakers4/silero-vad/wiki/Quality-Metrics)
- [whisper_streaming (LA-2 ref impl, Macháček 2023)](https://github.com/ufal/whisper_streaming) and [paper](https://aclanthology.org/2023.ijcnlp-demo.3.pdf)
- [WhisperLiveKit LocalAgreement backend](https://deepwiki.com/QuentinFuxa/WhisperLiveKit/3.2-localagreement-backend)
- [PromptingWhisper for zh/en CS (arXiv 2311.17382)](https://arxiv.org/abs/2311.17382)
- [Encoding Refining + Language-Aware Decoding for Whisper CS (arXiv 2412.16507)](https://arxiv.org/html/2412.16507v2)
- [Open-source STT 2026 benchmarks (Northflank)](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
- [On-device translation models — NLLB licensing trap, MADLAD-400 (Picovoice)](https://picovoice.ai/blog/open-source-translation/)
