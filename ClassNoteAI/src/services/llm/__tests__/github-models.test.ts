import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { keyStore } from '../keyStore';
import { GitHubModelsProvider } from '../providers/github-models';

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

describe('GitHubModelsProvider', () => {
    let provider: GitHubModelsProvider;

    beforeEach(() => {
        provider = new GitHubModelsProvider();
        keyStore.set('github-models', 'pat', 'ghp_test');
    });

    it('reports configured when PAT is stored', async () => {
        expect(await provider.isConfigured()).toBe(true);
        keyStore.clear('github-models', 'pat');
        expect(await provider.isConfigured()).toBe(false);
    });

    it('testConnection returns ok on 2xx', async () => {
        mockedFetch.mockResolvedValueOnce(jsonResponse({}) as never);
        const result = await provider.testConnection();
        expect(result.ok).toBe(true);
    });

    it('testConnection reports failure on 401', async () => {
        mockedFetch.mockResolvedValueOnce(jsonResponse('unauthorized', 401) as never);
        const result = await provider.testConnection();
        expect(result.ok).toBe(false);
        expect(result.message).toContain('401');
    });

    it('complete parses OpenAI-shaped response and maps usage', async () => {
        mockedFetch.mockResolvedValueOnce(
            jsonResponse({
                model: 'openai/gpt-5.4',
                choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 5 },
            }) as never
        );

        const res = await provider.complete({
            model: 'openai/gpt-5.4',
            messages: [{ role: 'user', content: 'hi' }],
            temperature: 0.1,
            maxTokens: 100,
        });

        expect(res.content).toBe('hello');
        expect(res.finishReason).toBe('stop');
        expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });

        const [, init] = mockedFetch.mock.calls[0];
        const body = JSON.parse(init!.body as string);
        expect(body.stream).toBe(false);
        expect(body.temperature).toBe(0.1);
        expect(body.max_tokens).toBe(100);
    });

    it('complete throws auth LLMError on 401', async () => {
        mockedFetch.mockResolvedValueOnce(jsonResponse('bad token', 401) as never);
        await expect(
            provider.complete({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
        ).rejects.toMatchObject({ kind: 'auth' });
    });

    it('complete throws without PAT', async () => {
        keyStore.clear('github-models', 'pat');
        await expect(
            provider.complete({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
        ).rejects.toMatchObject({ kind: 'auth' });
    });

    it('listModels returns the curated subset', async () => {
        const models = await provider.listModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models[0]).toHaveProperty('id');
        expect(models[0]).toHaveProperty('displayName');
    });
});
