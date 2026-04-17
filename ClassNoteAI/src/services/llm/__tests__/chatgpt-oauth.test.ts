import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { keyStore } from '../keyStore';
import { ChatGPTOAuthProvider } from '../providers/chatgpt-oauth';

const mockedFetch = vi.mocked(fetch);
const mockedInvoke = vi.mocked(invoke);
const mockedOpenUrl = vi.mocked(openUrl);

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
        body: null,
    } as unknown as Response;
}

/** Sets up an ordered queue of fetch responses. Each call to the mock
 *  consumes the next response. Out-of-bounds → undefined return. */
function queueFetchResponses(...responses: Response[]) {
    let idx = 0;
    mockedFetch.mockImplementation(() => Promise.resolve(responses[idx++] as never));
}

describe('ChatGPTOAuthProvider', () => {
    let provider: ChatGPTOAuthProvider;

    beforeEach(() => {
        provider = new ChatGPTOAuthProvider();
    });

    describe('isConfigured', () => {
        it('returns false when no access token', async () => {
            expect(await provider.isConfigured()).toBe(false);
        });
        it('returns true after tokens are stored', async () => {
            keyStore.set('chatgpt-oauth', 'accessToken', 'tok');
            expect(await provider.isConfigured()).toBe(true);
        });
    });

    describe('signIn', () => {
        it('opens browser to auth URL with PKCE + state, then exchanges code', async () => {
            // Capture the auth URL on openUrl, then resolve the listener
            // promise with a callback path carrying the matching state.
            let resolveListener: (r: { port: number; path: string }) => void;
            const listenerPromise = new Promise<{ port: number; path: string }>((r) => {
                resolveListener = r;
            });
            mockedInvoke.mockImplementation(() => listenerPromise as never);

            let capturedAuthUrl = '';
            mockedOpenUrl.mockImplementation(async (url: string | URL) => {
                capturedAuthUrl = String(url);
                const u = new URL(capturedAuthUrl);
                const state = u.searchParams.get('state');
                resolveListener!({ port: 1455, path: `/auth/callback?code=fake-code&state=${state}` });
            });

            queueFetchResponses(
                jsonResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })
            );

            const tokens = await provider.signIn();

            expect(tokens.accessToken).toBe('AT');
            expect(tokens.refreshToken).toBe('RT');
            expect(capturedAuthUrl).toContain('auth.openai.com/oauth/authorize');
            expect(capturedAuthUrl).toContain('client_id=app_EMoamEEZ73f0CkXaXp7hrann');
            expect(capturedAuthUrl).toContain('code_challenge_method=S256');
            expect(keyStore.get('chatgpt-oauth', 'accessToken')).toBe('AT');
            expect(keyStore.get('chatgpt-oauth', 'refreshToken')).toBe('RT');
        });

        it('rejects when state does not match (CSRF protection)', async () => {
            mockedInvoke.mockImplementation(
                () =>
                    Promise.resolve({ port: 1455, path: '/auth/callback?code=c&state=WRONG' }) as never
            );
            mockedOpenUrl.mockImplementation(async () => {});
            await expect(provider.signIn()).rejects.toMatchObject({ kind: 'auth' });
        });

        it('rejects when callback has error param', async () => {
            mockedInvoke.mockImplementation(
                () =>
                    Promise.resolve({ port: 1455, path: '/auth/callback?error=access_denied' }) as never
            );
            mockedOpenUrl.mockImplementation(async () => {});
            await expect(provider.signIn()).rejects.toMatchObject({ kind: 'auth' });
        });
    });

    describe('signOut', () => {
        it('clears all stored token fields', async () => {
            keyStore.set('chatgpt-oauth', 'accessToken', 'a');
            keyStore.set('chatgpt-oauth', 'refreshToken', 'r');
            keyStore.set('chatgpt-oauth', 'expiresAt', '1');
            await provider.signOut();
            expect(keyStore.has('chatgpt-oauth', 'accessToken')).toBe(false);
            expect(keyStore.has('chatgpt-oauth', 'refreshToken')).toBe(false);
            expect(keyStore.has('chatgpt-oauth', 'expiresAt')).toBe(false);
        });
    });

    describe('complete', () => {
        beforeEach(() => {
            keyStore.set('chatgpt-oauth', 'accessToken', 'AT');
            keyStore.set('chatgpt-oauth', 'expiresAt', String(Date.now() + 3_600_000));
        });

        it('translates OpenAI-shaped messages into Responses API body', async () => {
            queueFetchResponses(
                jsonResponse({
                    model: 'gpt-5',
                    output: [
                        { type: 'message', content: [{ type: 'output_text', text: 'hi' }] },
                    ],
                    status: 'completed',
                    usage: { input_tokens: 2, output_tokens: 1 },
                })
            );

            const res = await provider.complete({
                model: 'gpt-5',
                messages: [
                    { role: 'system', content: 'Be concise.' },
                    { role: 'user', content: 'Hello' },
                ],
                maxTokens: 100,
            });

            expect(res.content).toBe('hi');
            expect(res.finishReason).toBe('stop');

            const [url, init] = mockedFetch.mock.calls[0];
            expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
            const body = JSON.parse(init!.body as string);
            expect(body.instructions).toBe('Be concise.');
            expect(body.input).toEqual([
                { role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
            ]);
            expect(body.store).toBe(false);
            expect(body.max_output_tokens).toBe(100);
        });

        it('refreshes the access token when expired', async () => {
            keyStore.set('chatgpt-oauth', 'expiresAt', String(Date.now() - 10_000));
            keyStore.set('chatgpt-oauth', 'refreshToken', 'RT');

            queueFetchResponses(
                // 1. token refresh response
                jsonResponse({ access_token: 'NEW_AT', refresh_token: 'NEW_RT', expires_in: 3600 }),
                // 2. completion response
                jsonResponse({
                    output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
                    status: 'completed',
                })
            );

            await provider.complete({ model: 'gpt-5', messages: [{ role: 'user', content: 'x' }] });

            expect(mockedFetch).toHaveBeenCalledTimes(2);
            const [firstUrl] = mockedFetch.mock.calls[0];
            expect(firstUrl).toBe('https://auth.openai.com/oauth/token');
            const [, secondInit] = mockedFetch.mock.calls[1];
            expect(
                (secondInit!.headers as Record<string, string>).Authorization
            ).toBe('Bearer NEW_AT');
            expect(keyStore.get('chatgpt-oauth', 'accessToken')).toBe('NEW_AT');
        });

        it('throws auth error when not signed in', async () => {
            await provider.signOut();
            await expect(
                provider.complete({ model: 'gpt-5', messages: [{ role: 'user', content: 'x' }] })
            ).rejects.toMatchObject({ kind: 'auth' });
        });
    });
});
