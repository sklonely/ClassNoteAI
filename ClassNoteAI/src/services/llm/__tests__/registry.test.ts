import { describe, expect, it, beforeEach } from 'vitest';
import { keyStore } from '../keyStore';
import { getProvider, listProviders, resolveActiveProvider } from '../registry';

describe('LLM registry', () => {
    beforeEach(() => {
        keyStore.clear('github-models', 'pat');
        keyStore.clear('anthropic', 'apiKey');
    });

    it('lists known providers', () => {
        const ids = listProviders().map((d) => d.id);
        expect(ids).toContain('github-models');
        expect(ids).toContain('anthropic');
    });

    it('returns the same instance on repeated getProvider calls', () => {
        const a = getProvider('github-models');
        const b = getProvider('github-models');
        expect(a).toBe(b);
    });

    it('throws on unknown provider id', () => {
        expect(() => getProvider('not-a-thing')).toThrow();
    });

    it('resolveActiveProvider returns null when nothing configured', async () => {
        expect(await resolveActiveProvider()).toBeNull();
    });

    it('resolveActiveProvider prefers the configured one', async () => {
        keyStore.set('anthropic', 'apiKey', 'sk-ant-x');
        const active = await resolveActiveProvider();
        expect(active?.descriptor.id).toBe('anthropic');
    });

    it('resolveActiveProvider honors preferredId if configured', async () => {
        keyStore.set('github-models', 'pat', 'ghp_x');
        keyStore.set('anthropic', 'apiKey', 'sk-ant-x');
        const active = await resolveActiveProvider('anthropic');
        expect(active?.descriptor.id).toBe('anthropic');
    });
});
