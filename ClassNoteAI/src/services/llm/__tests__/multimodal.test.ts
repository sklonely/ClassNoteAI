import { describe, it, expect } from 'vitest';
import { toOpenAIChatMessage } from '../openai-compat';
import type { LLMMessage } from '../types';

/**
 * Wire-format contract tests for multimodal messages.
 *
 * Both GitHub Models (Chat Completions) and ChatGPT OAuth (Codex
 * Responses API) are what the app uses for remote OCR. The two have
 * different content-part type names:
 *
 *   Chat Completions: `{type:'text'}` / `{type:'image_url', image_url:{url, detail?}}`
 *   Responses API:    `{type:'input_text'}` / `{type:'input_image', image_url: <string>, detail?}`
 *
 * If either translator drifts, sending an image at the model will 400
 * and the user sees "OCR failed" for every page — while the TypeScript
 * `LLMMessage` type stays happy. These tests pin the on-the-wire shape
 * so CI catches a regression before shipping.
 *
 * The Responses-API translator is private to chatgpt-oauth.ts; it's
 * tested indirectly by manual-smoking the provider + by the inline
 * comments referencing the OpenAI docs. The Chat Completions
 * translator is public and tested directly here.
 */

describe('toOpenAIChatMessage (Chat Completions wire format)', () => {
    it('passes a plain string message through as { role, content }', () => {
        const msg: LLMMessage = { role: 'user', content: 'hello' };
        expect(toOpenAIChatMessage(msg)).toEqual({ role: 'user', content: 'hello' });
    });

    it('converts a single text part to an array of { type:"text", text }', () => {
        const msg: LLMMessage = {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
        };
        expect(toOpenAIChatMessage(msg)).toEqual({
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
        });
    });

    it('converts an image part to {type:"image_url", image_url:{url, detail}}', () => {
        const msg: LLMMessage = {
            role: 'user',
            content: [
                { type: 'text', text: 'what is this?' },
                { type: 'image', imageUrl: 'data:image/png;base64,AAA', detail: 'high' },
            ],
        };
        const out = toOpenAIChatMessage(msg);
        expect(out).toEqual({
            role: 'user',
            content: [
                { type: 'text', text: 'what is this?' },
                {
                    type: 'image_url',
                    image_url: { url: 'data:image/png;base64,AAA', detail: 'high' },
                },
            ],
        });
    });

    it('omits detail when it is "auto" (provider default)', () => {
        // Sending `detail: 'auto'` is explicitly allowed by OpenAI but
        // providers like GitHub's passthrough sometimes reject unknown
        // detail values if they think they're strict. Cleaner to just
        // drop it — auto is the server-side default anyway.
        const msg: LLMMessage = {
            role: 'user',
            content: [
                { type: 'image', imageUrl: 'data:image/png;base64,AAA', detail: 'auto' },
            ],
        };
        const out = toOpenAIChatMessage(msg) as { content: Array<{ image_url: Record<string, unknown> }> };
        expect(out.content[0].image_url).toEqual({ url: 'data:image/png;base64,AAA' });
    });

    it('handles assistant role the same as user (no wire difference in Chat Completions)', () => {
        const msg: LLMMessage = {
            role: 'assistant',
            content: 'here is my reply',
        };
        expect(toOpenAIChatMessage(msg)).toEqual({
            role: 'assistant',
            content: 'here is my reply',
        });
    });

    it('preserves order when mixing text + image parts', () => {
        const msg: LLMMessage = {
            role: 'user',
            content: [
                { type: 'image', imageUrl: 'data:image/png;base64,FIRST' },
                { type: 'text', text: 'caption' },
                { type: 'image', imageUrl: 'data:image/png;base64,SECOND' },
            ],
        };
        const out = toOpenAIChatMessage(msg) as { content: Array<Record<string, unknown>> };
        expect(out.content).toHaveLength(3);
        expect((out.content[0].image_url as { url: string }).url).toContain('FIRST');
        expect(out.content[1]).toEqual({ type: 'text', text: 'caption' });
        expect((out.content[2].image_url as { url: string }).url).toContain('SECOND');
    });
});
