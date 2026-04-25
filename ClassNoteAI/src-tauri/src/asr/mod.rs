//! Streaming ASR — in-process Nemotron via parakeet-rs.
//!
//! The whole transcription pipeline is built around a single concept:
//! audio chunks come in, transcript deltas come out. There is no
//! rolling audio buffer, no "reprocess everything" cycle, no
//! Whisper-specific `segments` shape — that's all v1 (deleted in this
//! refactor). There is also no HTTP sidecar / SSE protocol — that was
//! the v2.0 design, replaced in v2.1 with the in-process engine
//! because (a) Python in a Rust+TS stack made packaging miserable and
//! (b) the per-chunk HTTP roundtrip was wasted latency for a
//! same-process model.
//!
//! Public surface:
//!   * [`parakeet_model`] — file paths and download configs for the
//!     four ONNX/tokenizer files Nemotron loads from disk.
//!   * [`parakeet_engine`] — the runtime: load the model, open a
//!     session, push PCM, get text deltas back via a callback.
//!
//! See `parakeet_engine` module docs for the cache-aware streaming
//! protocol and the chunk-size rationale.

pub mod parakeet_engine;
pub mod parakeet_model;
