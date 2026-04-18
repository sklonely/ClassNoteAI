import { describe, it, expect, vi } from 'vitest';
import { pickVisionModel } from '../remoteOcrService';

/**
 * Unit tests for the v0.5.2 remote OCR service.
 *
 * The service itself is thin glue; the non-trivial parts are:
 *   1. `pickVisionModel` — filter + preference ordering for the
 *      "which vision model does this provider have?" decision
 *   2. wire-format translation (tested in the dedicated multimodal
 *      serialisation test)
 *
 * End-to-end OCR against a real provider is left to manual smoke
 * testing / the nightly eval harness — it needs network, tokens, and
 * a real PDF, none of which belong in a unit test.
 */

describe('pickVisionModel', () => {
    const mk = (id: string, vision = false) => ({
        id,
        displayName: id,
        capabilities: vision ? { vision: true } : {},
    });

    it('returns null when no model is vision-capable', () => {
        const out = pickVisionModel([mk('text-only-1'), mk('text-only-2')]);
        expect(out).toBeNull();
    });

    it('picks the preferred model id when present', () => {
        const models = [
            mk('text-only', false),
            mk('gpt-4o-mini', true),
            mk('claude-3-5-sonnet', true),
        ];
        const out = pickVisionModel(models, 'claude-3-5-sonnet');
        expect(out?.id).toBe('claude-3-5-sonnet');
    });

    it('falls back to the preference-order bias when preferred is absent', () => {
        // User didn't specify a preferred model; service should pick
        // cost-efficient small vision models first.
        const models = [
            mk('claude-3-5-sonnet', true),
            mk('gpt-4o', true),
            mk('gpt-4o-mini', true),
        ];
        const out = pickVisionModel(models);
        expect(out?.id).toBe('gpt-4o-mini');
    });

    it('handles provider-prefixed model ids (GitHub Models style)', () => {
        // GitHub Models exposes ids like `openai/gpt-4o-mini` while
        // ChatGPT OAuth uses bare `gpt-4o-mini`. Both are in the
        // preference list so either provider lands on the small model.
        const models = [mk('openai/gpt-4o-mini', true), mk('openai/gpt-5', true)];
        const out = pickVisionModel(models);
        expect(out?.id).toBe('openai/gpt-4o-mini');
    });

    it('falls through to first-vision if none of the preferred ids match', () => {
        const models = [mk('some-new-vision-model-2030', true), mk('text-only', false)];
        const out = pickVisionModel(models);
        expect(out?.id).toBe('some-new-vision-model-2030');
    });

    it('skips non-vision models even when they appear first in the list', () => {
        const models = [
            mk('text-only', false),
            mk('gpt-4o-mini', true),
            mk('other-non-vision', false),
        ];
        const out = pickVisionModel(models);
        expect(out?.id).toBe('gpt-4o-mini');
    });
});

// ----------- suppress "unused var" without exporting -----------
// vi is imported to trigger vitest's global test environment setup
// in case any dynamic import inside remoteOcrService tries to read
// mocks. Explicitly reference it so tsc with noUnusedLocals is happy.
void vi;
