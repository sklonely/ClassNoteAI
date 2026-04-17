import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { keyStore } from '../keyStore';
import { OpenAIProvider } from '../providers/openai';
import { GeminiProvider } from '../providers/gemini';

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

describe('OpenAIProvider', () => {
    beforeEach(() => {
        keyStore.set('openai', 'apiKey', 'sk-test');
    });

    it('sends Bearer auth header and hits the OpenAI chat endpoint', async () => {
        mockedFetch.mockResolvedValueOnce(
            jsonResponse({
                model: 'gpt-5.4',
                choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1 },
            }) as never
        );

        const provider = new OpenAIProvider();
        await provider.complete({
            model: 'gpt-5.4',
            messages: [{ role: 'user', content: 'hi' }],
        });

        const [url, init] = mockedFetch.mock.calls[0];
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    });

    it('rejects with auth error when no key is stored', async () => {
        keyStore.clear('openai', 'apiKey');
        const provider = new OpenAIProvider();
        await expect(
            provider.complete({ model: 'gpt-5.4', messages: [{ role: 'user', content: 'hi' }] })
        ).rejects.toMatchObject({ kind: 'auth' });
    });
});

describe('GeminiProvider', () => {
    beforeEach(() => {
        keyStore.set('gemini', 'apiKey', 'AIza-test');
    });

    it('uses the OpenAI-compatible Gemini endpoint with Bearer auth', async () => {
        mockedFetch.mockResolvedValueOnce(
            jsonResponse({
                model: 'gemini-2.5-pro',
                choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
            }) as never
        );

        const provider = new GeminiProvider();
        await provider.complete({
            model: 'gemini-2.5-pro',
            messages: [{ role: 'user', content: 'hi' }],
        });

        const [url, init] = mockedFetch.mock.calls[0];
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
        expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer AIza-test');
    });

    it('reports not configured when key missing', async () => {
        keyStore.clear('gemini', 'apiKey');
        const provider = new GeminiProvider();
        expect(await provider.isConfigured()).toBe(false);
    });
});
