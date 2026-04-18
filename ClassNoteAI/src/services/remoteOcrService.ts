/**
 * Remote LLM OCR service.
 *
 * Why this exists: the original `ocrService.ts` speaks to a local Ollama
 * with deepseek-ocr loaded. In practice ~99% of users don't have that
 * configured, so `ragService.indexLectureWithOCR` pre-flight-skipped to
 * pdfjs text extraction — which is blind to images, handwritten math,
 * tables-as-image, and any scanned slides. v0.5.2 adds this service as
 * the default OCR path: routes page images through whatever cloud LLM
 * the user already has configured (GitHub Models / ChatGPT OAuth), so
 * real OCR "just works" without another local daemon.
 *
 * Provider picking:
 *   - Uses `resolveActiveProvider()` — the same one powering AI 助教 /
 *     summary / keywords.
 *   - Filters `listModels()` to vision-capable entries so we don't try
 *     to send images at a text-only model and get a 400.
 *   - ChatGPT subscription and Copilot/GitHub Models have different
 *     available model IDs — the filter + pick-best logic below handles
 *     both without caller branching.
 *
 * Concurrency: map phase of a multi-page OCR is throttled to 3
 * simultaneous calls (same rationale as summarize's map phase — both
 * 429 before 10 concurrent on both providers).
 */

import {
    resolveActiveProvider,
    type LLMContentPart,
    type LLMMessage,
    type LLMModelInfo,
    type LLMProvider,
    usageTracker,
} from './llm';

export interface OCRResult {
    pageNumber: number;
    text: string;
    success: boolean;
    error?: string;
}

/** Picks the first vision-capable model the provider exposes. Callers
 *  can override via `preferredModel`. Exported for tests / for the UI
 *  model-picker that might replace the auto-pick later. */
export function pickVisionModel(
    models: LLMModelInfo[],
    preferredModel?: string,
): LLMModelInfo | null {
    const visionOnly = models.filter((m) => m.capabilities?.vision);
    if (visionOnly.length === 0) return null;
    if (preferredModel) {
        const exact = visionOnly.find((m) => m.id === preferredModel);
        if (exact) return exact;
    }
    // Light bias toward known-good small models that are cheap *and*
    // accurate for OCR. If neither is present, first-in-catalog wins.
    const preferredOrder = [
        'openai/gpt-4o-mini',
        'gpt-4o-mini',
        'openai/gpt-4o',
        'gpt-4o',
        'google/gemini-2.5-flash',
        'gemini-2.5-flash',
        'anthropic/claude-3-5-sonnet',
        'claude-3-5-sonnet',
    ];
    for (const id of preferredOrder) {
        const hit = visionOnly.find((m) => m.id === id);
        if (hit) return hit;
    }
    return visionOnly[0];
}

const OCR_SYSTEM_PROMPT =
    'You are an OCR engine specialised in academic lecture slides. ' +
    'Extract ALL text, equations, tables, and figure captions from the image. ' +
    'Output ONLY clean Markdown — no preamble, no explanation of what the image is. ' +
    'Rules:\n' +
    '- Preserve heading hierarchy (# / ## / ###) matching visual prominence.\n' +
    '- Render math in LaTeX inside $ ... $ (inline) or $$ ... $$ (display).\n' +
    '- Render tables with GFM pipe syntax.\n' +
    '- Describe diagrams in one concise sentence prefixed with "Figure: " only if they carry information beyond decoration.\n' +
    '- If the slide is effectively empty (title-only, blank, pure decoration), output an empty string.';

class RemoteOcrService {
    private static readonly OCR_CONCURRENCY = 3;

    /**
     * True if any configured LLM provider has at least one vision-capable
     * model. Cheap — used for the "is remote OCR available" pre-flight
     * in `ragService.indexLectureWithOCR`.
     */
    public async isAvailable(): Promise<boolean> {
        try {
            const provider = await resolveActiveProvider();
            if (!provider) return false;
            const models = await provider.listModels();
            return models.some((m) => m.capabilities?.vision);
        } catch {
            return false;
        }
    }

    /** Single-page OCR. Exported mainly for testing — production callers
     *  should go through `recognizePages` for concurrency + progress. */
    public async recognizePage(
        imageBase64: string,
        pageNumber: number,
        provider?: LLMProvider,
        model?: string,
    ): Promise<OCRResult> {
        try {
            const p = provider ?? (await resolveActiveProvider());
            if (!p) {
                return {
                    pageNumber,
                    text: '',
                    success: false,
                    error: 'No LLM provider configured',
                };
            }
            const m = model ?? pickVisionModel(await p.listModels())?.id;
            if (!m) {
                return {
                    pageNumber,
                    text: '',
                    success: false,
                    error: 'Active provider has no vision-capable model',
                };
            }

            // Normalise to a data URL. Callers pass bare base64 (matching
            // the ocrService contract); LLM providers universally accept
            // `data:image/png;base64,...`.
            const imageUrl = imageBase64.startsWith('data:')
                ? imageBase64
                : `data:image/png;base64,${imageBase64}`;

            const content: LLMContentPart[] = [
                { type: 'text', text: `Slide ${pageNumber}:` },
                { type: 'image', imageUrl, detail: 'high' },
            ];
            const messages: LLMMessage[] = [
                { role: 'system', content: OCR_SYSTEM_PROMPT },
                { role: 'user', content },
            ];

            const res = await p.complete({
                model: m,
                messages,
                temperature: 0,
                maxTokens: 2048,
            });
            // Record under 'chat' task so the user's usage view still
            // shows the spend — OCR isn't one of the task labels.
            usageTracker.record({
                providerId: p.descriptor.id,
                model: m,
                task: 'chat',
                inputTokens: res.usage?.inputTokens ?? 0,
                outputTokens: res.usage?.outputTokens ?? 0,
            });
            return { pageNumber, text: res.content.trim(), success: true };
        } catch (err) {
            return {
                pageNumber,
                text: '',
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    /**
     * Multi-page OCR with concurrency control.
     * Contract matches the local `ocrService.recognizePages` so
     * `ragService.indexLectureWithOCR` can swap between them by
     * one line change.
     */
    public async recognizePages(
        pages: { pageNumber: number; imageBase64: string }[],
        onProgress?: (current: number, total: number) => void,
    ): Promise<OCRResult[]> {
        const provider = await resolveActiveProvider();
        if (!provider) {
            return pages.map((p) => ({
                pageNumber: p.pageNumber,
                text: '',
                success: false,
                error: 'No LLM provider configured',
            }));
        }
        const visionModel = pickVisionModel(await provider.listModels());
        if (!visionModel) {
            return pages.map((p) => ({
                pageNumber: p.pageNumber,
                text: '',
                success: false,
                error: 'Active provider has no vision-capable model',
            }));
        }

        const results: OCRResult[] = new Array(pages.length);
        let completed = 0;
        let cursor = 0;
        const workers = Array.from(
            { length: Math.min(RemoteOcrService.OCR_CONCURRENCY, pages.length) },
            async () => {
                while (true) {
                    const i = cursor++;
                    if (i >= pages.length) return;
                    const r = await this.recognizePage(
                        pages[i].imageBase64,
                        pages[i].pageNumber,
                        provider,
                        visionModel.id,
                    );
                    results[i] = r;
                    completed += 1;
                    onProgress?.(completed, pages.length);
                }
            },
        );
        await Promise.all(workers);
        return results;
    }
}

export const remoteOcrService = new RemoteOcrService();
