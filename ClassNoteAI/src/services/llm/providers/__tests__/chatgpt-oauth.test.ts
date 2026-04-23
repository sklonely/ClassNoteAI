/**
 * chatgpt-oauth provider regression tests — buildResponsesBody only.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 2 §chatgpt-oauth jsonMode):
 *   - #93  Responses API rejects `text.format=json_object` unless the literal
 *          word "json" appears in `input`. Our system prompts put "JSON" in
 *          `instructions` (which the validator does NOT count), so jsonMode
 *          requests with no "json" in user input were 400ing.
 *   - case-insensitive match (must accept "JSON" / "Json" / "json")
 *   - jsonMode=false leaves input untouched
 *   - jsonMode=true with input already mentioning json → no append
 *
 * We bypass OAuth + fetch entirely and exercise the private buildResponsesBody
 * via bracket-access. The hint logic is pure data transformation; the rest of
 * the provider (token refresh, SSE streaming) has its own concerns.
 */

import { describe, it, expect } from 'vitest';
import { ChatGPTOAuthProvider } from '../chatgpt-oauth';
import type { LLMRequest } from '../../types';

// Bracket-access the private method. Acceptable for test-only access.
function callBuild(provider: ChatGPTOAuthProvider, request: LLMRequest, stream = false) {
    return (provider as unknown as {
        buildResponsesBody(request: LLMRequest, stream: boolean): Record<string, unknown>;
    }).buildResponsesBody(request, stream);
}

type InputPart = { type: 'input_text' | 'output_text' | 'input_image'; text?: string };
type InputMessage = { role: 'user' | 'assistant'; content: InputPart[] };

function getInputTexts(body: Record<string, unknown>): string[] {
    const input = body.input as InputMessage[];
    return input.flatMap((m) => m.content.map((p) => p.text ?? ''));
}

describe('ChatGPTOAuthProvider.buildResponsesBody', () => {
    const provider = new ChatGPTOAuthProvider();

    describe('regression #93 — json hint injection on Responses API', () => {
        it('appends 以 JSON 格式回傳。 when jsonMode=true and no input mentions json', () => {
            // This is the exact extractSyllabus shape that was 400ing before
            // commit dc52eac landed: system prompt has "JSON" but user input
            // does not. The provider maps system → instructions (separate
            // field), so the validator never sees the system "JSON" mention.
            const request: LLMRequest = {
                model: 'gpt-5',
                messages: [
                    { role: 'system', content: '從使用者提供的課程描述中抽取結構化資訊並回傳 JSON。' },
                    { role: 'user', content: 'Course title: ML\n\nWeek 1: linear algebra' },
                ],
                jsonMode: true,
            };

            const body = callBuild(provider, request);

            expect(body.text).toEqual({ format: { type: 'json_object' } });
            const inputTexts = getInputTexts(body);
            // Hint must appear somewhere in the input field.
            expect(inputTexts.some((t) => /json/i.test(t))).toBe(true);
            // And specifically as the appended hint, not by accident.
            expect(inputTexts).toContain('以 JSON 格式回傳。');
        });

        it('does NOT append a hint when input already mentions json (case-insensitive)', () => {
            for (const variant of ['json', 'JSON', 'Json', 'jSoN']) {
                const request: LLMRequest = {
                    model: 'gpt-5',
                    messages: [{ role: 'user', content: `Please respond in ${variant} format.` }],
                    jsonMode: true,
                };
                const body = callBuild(provider, request);
                const texts = getInputTexts(body);
                expect(texts).not.toContain('以 JSON 格式回傳。');
                // text.format still set
                expect(body.text).toEqual({ format: { type: 'json_object' } });
            }
        });

        it('does NOT append when jsonMode=false', () => {
            const request: LLMRequest = {
                model: 'gpt-5',
                messages: [{ role: 'user', content: 'just chat' }],
                jsonMode: false,
            };
            const body = callBuild(provider, request);
            expect(body.text).toBeUndefined();
            expect(getInputTexts(body)).not.toContain('以 JSON 格式回傳。');
        });

        it('does NOT append when jsonMode is omitted', () => {
            const request: LLMRequest = {
                model: 'gpt-5',
                messages: [{ role: 'user', content: 'no jsonMode at all' }],
            };
            const body = callBuild(provider, request);
            expect(body.text).toBeUndefined();
        });

        it('appends to the LAST user message when there are multiple turns', () => {
            const request: LLMRequest = {
                model: 'gpt-5',
                messages: [
                    { role: 'user', content: 'first' },
                    { role: 'assistant', content: 'reply' },
                    { role: 'user', content: 'second' },
                ],
                jsonMode: true,
            };
            const body = callBuild(provider, request);
            const input = body.input as InputMessage[];
            const lastMsg = input[input.length - 1];
            // Hint sits on the last message
            expect(lastMsg.content.some((p) => p.text === '以 JSON 格式回傳。')).toBe(true);
        });

        it('inspects input_text AND output_text parts when checking for existing json mention', () => {
            // Assistant turn (mapped to output_text) with "json" in it should
            // satisfy the validator without any hint append.
            const request: LLMRequest = {
                model: 'gpt-5',
                messages: [
                    { role: 'user', content: 'kick off' },
                    { role: 'assistant', content: '{"format": "json"}' },
                    { role: 'user', content: 'continue' },
                ],
                jsonMode: true,
            };
            const body = callBuild(provider, request);
            expect(getInputTexts(body)).not.toContain('以 JSON 格式回傳。');
        });
    });

    describe('input shape sanity (guards future Responses API drift)', () => {
        it('collapses system messages into the instructions field', () => {
            const request: LLMRequest = {
                model: 'gpt-5',
                messages: [
                    { role: 'system', content: 'sys A' },
                    { role: 'system', content: 'sys B' },
                    { role: 'user', content: 'hi' },
                ],
            };
            const body = callBuild(provider, request);
            // system → instructions, NOT into input
            expect(body.instructions).toBe('sys A\n\nsys B');
            const input = body.input as InputMessage[];
            expect(input.every((m) => m.role !== 'system' as never)).toBe(true);
        });

        it('falls back to a default instructions string when no system message exists', () => {
            const request: LLMRequest = {
                model: 'gpt-5',
                messages: [{ role: 'user', content: 'hi' }],
            };
            const body = callBuild(provider, request);
            // The exact text is implementation detail; just assert non-empty
            // and not the joined-systems form ('').
            expect(typeof body.instructions).toBe('string');
            expect((body.instructions as string).length).toBeGreaterThan(0);
        });

        it('always includes encrypted_content in `include` (required for Codex models)', () => {
            const request: LLMRequest = {
                model: 'gpt-5',
                messages: [{ role: 'user', content: 'hi' }],
            };
            const body = callBuild(provider, request);
            expect(body.include).toEqual(['reasoning.encrypted_content']);
        });

        it('forwards stream parameter to body.stream', () => {
            const request: LLMRequest = {
                model: 'gpt-5',
                messages: [{ role: 'user', content: 'hi' }],
            };
            expect(callBuild(provider, request, true).stream).toBe(true);
            expect(callBuild(provider, request, false).stream).toBe(false);
        });

        it('uses store:false (stateless requests, required for our usage)', () => {
            const body = callBuild(provider, {
                model: 'gpt-5',
                messages: [{ role: 'user', content: 'hi' }],
            });
            expect(body.store).toBe(false);
        });
    });
});
