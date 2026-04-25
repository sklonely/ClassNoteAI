/**
 * Build-time feature flag query.
 *
 * Mirrors the Rust `cfg!(feature = "...")` results from this binary so the
 * renderer can adapt — e.g. hide the "本地 ONNX" option when the build
 * skipped the `nmt-local` feature, or auto-migrate stale settings from
 * a provider that isn't available.
 *
 * The flags are baked at compile time on the Rust side so this is a
 * one-shot query: cache the result for the lifetime of the renderer.
 */

import { invoke } from '@tauri-apps/api/core';

export interface BuildFeatures {
  /** `nmt-local` cargo feature — pulls in ct2rs + sentencepiece (M2M100). */
  nmt_local: boolean;
  /** `gpu-cuda` — Whisper CUDA + CT2 cuda-dynamic-loading. Implies nmt_local. */
  gpu_cuda: boolean;
  /** `gpu-metal` — macOS Metal for whisper + candle. */
  gpu_metal: boolean;
  /** `gpu-vulkan` — Whisper Vulkan backend. */
  gpu_vulkan: boolean;
}

let cached: BuildFeatures | null = null;
let inflight: Promise<BuildFeatures> | null = null;

/**
 * Returns the build's feature flags. The first call hits Tauri IPC; later
 * calls return the cached value (flags can't change at runtime).
 *
 * On unexpected failure (very early in app startup, before Tauri IPC is
 * ready), returns a conservative default — `nmt_local: true` to keep
 * historical behavior so we don't accidentally hide working backends.
 */
export async function getBuildFeatures(): Promise<BuildFeatures> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const features = await invoke<BuildFeatures>('get_build_features');
      cached = features;
      return features;
    } catch (e) {
      console.warn('[buildFeatures] failed to query build features, using conservative default:', e);
      // Conservative default: assume all on so legacy users don't lose
      // backends they had access to before this query existed.
      const fallback: BuildFeatures = {
        nmt_local: true,
        gpu_cuda: false,
        gpu_metal: false,
        gpu_vulkan: false,
      };
      cached = fallback;
      return fallback;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Test-only escape hatch. The cached result lives for the lifetime of the
 * renderer, so unit tests need a way to reset between cases.
 */
export function _resetBuildFeaturesCache(): void {
  cached = null;
  inflight = null;
}
