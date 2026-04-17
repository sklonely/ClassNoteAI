import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { keyStore } from '../keyStore';
import { AnthropicProvider } from '../providers/anthropic';

const mockedFetch = vi.mocked(fetch);

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
        body: null,
    } as unknown as Response;
}

describe('AnthropicProvider', () => {
    let provider: AnthropicProvider;

    beforeEach(() => {
        provider = new AnthropicProvider();
        keyStore.set('anthropic', 'apiKey', 'sk-ant-test');
    });

    it('reports configured when API key is stored', async () => {
        expect(await provider.isConfigured()).toBe(true);
    });

    it('converts OpenAI-shaped messages into Anthropic shape (system separated)', async () => {
        mockedFetch.mockResolvedValueOnce(
            jsonResponse({
                model: 'claude-sonnet-4-6',
                content: [{ type: 'text', text: 'hi back' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 7, output_tokens: 3 },
            }) as never
        );

        await provider.complete({
            model: 'claude-sonnet-4-6',
            messages: [
                { role: 'system', content: 'You are terse.' },
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' },
                { role: 'user', content: 'again' },
            ],
            maxTokens: 50,
        });

        const [, init] = mockedFetch.mock.calls[0];
        const body = JSON.parse(init!.body as string);
        expect(body.system).toBe('You are terse.');
        expect(body.messages).toEqual([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
            { role: 'user', content: 'again' },
        ]);
        expect(body.max_tokens).toBe(50);
    });

    it('concatenates multiple system messages', async () => {
        mockedFetch.mockResolvedValueOnce(
            jsonResponse({
                content: [{ type: 'text', text: '' }],
                usage: { input_tokens: 0, output_tokens: 0 },
            }) as never
        );

        await provider.complete({
            model: 'claude-haiku-4-5',
            messages: [
                { role: 'system', content: 'A' },
                { role: 'system', content: 'B' },
                { role: 'user', content: 'q' },
            ],
        });

        const [, init] = mockedFetch.mock.calls[0];
        const body = JSON.parse(init!.body as string);
        expect(body.system).toBe('A\n\nB');
    });

    it('extracts text from content blocks and maps stop_reason', async () => {
        mockedFetch.mockResolvedValueOnce(
            jsonResponse({
                model: 'claude-sonnet-4-6',
                content: [
                    { type: 'text', text: 'part 1 ' },
                    { type: 'text', text: 'part 2' },
                ],
                stop_reason: 'max_tokens',
                usage: { input_tokens: 4, output_tokens: 2 },
            }) as never
        );

        const res = await provider.complete({
            model: 'claude-sonnet-4-6',
            messages: [{ role: 'user', content: 'x' }],
        });

        expect(res.content).toBe('part 1 part 2');
        expect(res.finishReason).toBe('length');
        expect(res.usage).toEqual({ inputTokens: 4, outputTokens: 2 });
    });

    it('sends the browser-access header Anthropic requires for direct calls', async () => {
        mockedFetch.mockResolvedValueOnce(
            jsonResponse({ content: [], usage: { input_tokens: 0, output_tokens: 0 } }) as never
        );

        await provider.complete({
            model: 'claude-haiku-4-5',
            messages: [{ role: 'user', content: 'hi' }],
        });

        const [, init] = mockedFetch.mock.calls[0];
        const headers = init!.headers as Record<string, string>;
        expect(headers['x-api-key']).toBe('sk-ant-test');
        expect(headers['anthropic-version']).toBeDefined();
        expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    });

    it('throws auth LLMError on 401', async () => {
        mockedFetch.mockResolvedValueOnce(jsonResponse({ error: 'bad' }, 401) as never);
        await expect(
            provider.complete({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
        ).rejects.toMatchObject({ kind: 'auth' });
    });
});
