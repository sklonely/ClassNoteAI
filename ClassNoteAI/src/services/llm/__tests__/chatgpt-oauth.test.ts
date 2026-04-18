import { describe, expect, it, beforeEach } from 'vitest';
import { keyStore } from '../keyStore';
import { ChatGPTOAuthProvider } from '../providers/chatgpt-oauth';

/**
 * Tests for the parts of ChatGPTOAuthProvider that DON'T involve
 * network I/O: credential storage + surface contract. The signIn
 * flow and SSE-based complete() are exercised live via scripts/
 * dev-ctl.mjs since both depend on Tauri's native-Rust fetch, the
 * `oauth:bound` event, and the ChatGPT backend's stream-only
 * Responses endpoint — none of which is round-trippable in a
 * vitest + jsdom env without heavy mocking. See dev-ctl smoke-test
 * run in the v0.5.2 Settings-redesign PR description for the live
 * verification receipts.
 */
describe('ChatGPTOAuthProvider (credential surface)', () => {
    let provider: ChatGPTOAuthProvider;

    beforeEach(() => {
        keyStore.clear('chatgpt-oauth', 'accessToken');
        keyStore.clear('chatgpt-oauth', 'refreshToken');
        keyStore.clear('chatgpt-oauth', 'expiresAt');
        provider = new ChatGPTOAuthProvider();
    });

    it('isConfigured is false without stored access token', async () => {
        expect(await provider.isConfigured()).toBe(false);
    });

    it('isConfigured is true after an access token is stored', async () => {
        keyStore.set('chatgpt-oauth', 'accessToken', 'tok');
        expect(await provider.isConfigured()).toBe(true);
    });

    it('signOut clears all three token fields', async () => {
        keyStore.set('chatgpt-oauth', 'accessToken', 'a');
        keyStore.set('chatgpt-oauth', 'refreshToken', 'r');
        keyStore.set('chatgpt-oauth', 'expiresAt', '1');
        await provider.signOut();
        expect(keyStore.has('chatgpt-oauth', 'accessToken')).toBe(false);
        expect(keyStore.has('chatgpt-oauth', 'refreshToken')).toBe(false);
        expect(keyStore.has('chatgpt-oauth', 'expiresAt')).toBe(false);
    });

    it('complete rejects with auth error when not signed in', async () => {
        await expect(
            provider.complete({
                model: 'gpt-5.2',
                messages: [{ role: 'user', content: 'x' }],
            }),
        ).rejects.toMatchObject({ kind: 'auth' });
    });

    it('descriptor reports the expected id and auth mode', () => {
        expect(provider.descriptor.id).toBe('chatgpt-oauth');
        expect(provider.descriptor.authType).toBe('oauth');
    });
});
