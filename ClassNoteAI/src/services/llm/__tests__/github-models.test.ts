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

    it('infers vision support for GitHub catalog rows that omit explicit vision capability', async () => {
        mockedFetch.mockResolvedValueOnce(
            jsonResponse([
                {
                    id: 'openai/gpt-4o-mini',
                    name: 'GPT-4o mini',
                    publisher: 'OpenAI',
                    capabilities: ['agents', 'assistants', 'streaming', 'tool-calling', 'agentsV2'],
                    limits: { max_input_tokens: 131072, max_output_tokens: 4096 },
                },
                {
                    id: 'openai/gpt-4.1-mini',
                    name: 'GPT-4.1 mini',
                    publisher: 'OpenAI',
                    capabilities: ['agents', 'streaming', 'tool-calling', 'agentsV2'],
                    limits: { max_input_tokens: 1048576, max_output_tokens: 32768 },
                },
                {
                    id: 'openai/gpt-4.1',
                    name: 'GPT-4.1',
                    publisher: 'OpenAI',
                    capabilities: ['agents', 'streaming', 'tool-calling', 'agentsV2'],
                    limits: { max_input_tokens: 1048576, max_output_tokens: 32768 },
                },
            ]) as never
        );

        const models = await provider.listModels();

        expect(models.find((m) => m.id === 'openai/gpt-4o-mini')?.capabilities?.vision).toBe(true);
        expect(models.find((m) => m.id === 'openai/gpt-4.1-mini')?.capabilities?.vision).toBe(true);
        expect(models.find((m) => m.id === 'openai/gpt-4.1')?.capabilities?.vision).toBe(true);
    });

    it('does not mark unrelated catalog rows as vision-capable', async () => {
        mockedFetch.mockResolvedValueOnce(
            jsonResponse([
                {
                    id: 'openai/gpt-4.1-nano',
                    name: 'GPT-4.1 nano',
                    publisher: 'OpenAI',
                    capabilities: ['agents', 'streaming', 'tool-calling', 'agentsV2'],
                    limits: { max_input_tokens: 1048576, max_output_tokens: 32768 },
                },
                {
                    id: 'meta/llama-3.3-70b-instruct',
                    name: 'Llama 3.3 70B Instruct',
                    publisher: 'Meta',
                    capabilities: ['streaming', 'tool-calling'],
                    limits: { max_input_tokens: 131072, max_output_tokens: 4096 },
                },
            ]) as never
        );

        const models = await provider.listModels();

        expect(models.find((m) => m.id === 'openai/gpt-4.1-nano')?.capabilities?.vision).toBeUndefined();
        expect(models.find((m) => m.id === 'meta/llama-3.3-70b-instruct')?.capabilities?.vision).toBeUndefined();
    });

    // Catalog parser drift guards (regression-test-checklist Phase 2
    // §github-models). The April 2026 catalog dropped vision flags from
    // a number of models; the parser must tolerate other future drift
    // without crashing or returning an empty list.
    describe('catalog parser drift guards (#32 + #110 maintenance)', () => {
        it('catalog HTTP failure → returns hardcoded FALLBACK list, not empty', async () => {
            mockedFetch.mockRejectedValueOnce(new Error('network down'));
            const models = await provider.listModels();
            // Must not be empty — the provider falls back to a curated list
            // so the user never sees a blank model picker.
            expect(models.length).toBeGreaterThan(0);
            // The fallback contains the openai flagship at minimum.
            expect(models.find((m) => m.id === 'openai/gpt-4.1')).toBeTruthy();
        });

        it('catalog row missing capabilities array → defaults streaming to true, no crash', async () => {
            mockedFetch.mockResolvedValueOnce(
                jsonResponse([
                    {
                        id: 'unknown-vendor/some-future-model',
                        name: 'Mystery Model',
                        publisher: 'Unknown',
                        // capabilities key missing entirely
                    },
                ]) as never,
            );
            const models = await provider.listModels();
            const m = models.find((x) => x.id === 'unknown-vendor/some-future-model');
            expect(m).toBeTruthy();
            expect(m!.capabilities?.streaming).toBe(true);
            // jsonMode should be undefined (not falsely true) when not advertised.
            expect(m!.capabilities?.jsonMode).toBeUndefined();
            // vision should also be undefined for unknown-vendor models.
            expect(m!.capabilities?.vision).toBeUndefined();
        });

        it('completely unknown row shape → loaded with safe defaults', async () => {
            mockedFetch.mockResolvedValueOnce(
                jsonResponse([
                    {
                        id: 'totally/new-model',
                        // No name, no publisher, no capabilities, no limits.
                    },
                ]) as never,
            );
            const models = await provider.listModels();
            const m = models.find((x) => x.id === 'totally/new-model');
            expect(m).toBeTruthy();
            // displayName falls back to the id when name is missing.
            expect(m!.displayName).toBe('totally/new-model');
            // No crash, capabilities object exists with at least streaming.
            expect(m!.capabilities).toBeTruthy();
        });

        it('catalog returns empty array → returns FALLBACK list (don\'t serve a blank picker)', async () => {
            mockedFetch.mockResolvedValueOnce(jsonResponse([]) as never);
            const models = await provider.listModels();
            // Even though the catalog said "no models", we should serve
            // the curated fallback so the user can still pick something.
            // (This protects against silent catalog outages.)
            expect(models.length).toBeGreaterThan(0);
        });

        it('explicit "vision" capability tag → vision=true', async () => {
            mockedFetch.mockResolvedValueOnce(
                jsonResponse([
                    {
                        id: 'someone/multimodal-v1',
                        name: 'Multimodal v1',
                        publisher: 'Someone',
                        capabilities: ['streaming', 'vision'],
                    },
                ]) as never,
            );
            const models = await provider.listModels();
            const m = models.find((x) => x.id === 'someone/multimodal-v1');
            expect(m?.capabilities?.vision).toBe(true);
        });
    });
});
