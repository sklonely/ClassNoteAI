/**
 * logDiagnostics regression tests.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 2
 * §logDiagnostics service):
 *   - #73 PII redaction is the load-bearing rule. Any token / API key
 *         / OS user path shipped in a bug-report log MUST be redacted
 *         BEFORE the user is asked to attach it. The redactor is the
 *         only thing standing between user-pasted logs and credential
 *         leaks on public GitHub issues.
 *   - URL builder for the github-issue create endpoint should fully
 *         encode the body and embed the version string.
 *
 * Pure function tests; no jsdom or invoke needed.
 */

import { describe, it, expect } from 'vitest';
import { redactLogContent, buildGithubIssueUrl } from '../logDiagnostics';

describe('redactLogContent — PII guards (regression #73)', () => {
    it('redacts OpenAI sk- keys', () => {
        const { redacted, hits } = redactLogContent(
            'auth header: sk-1234567890abcdefABCDEF',
        );
        expect(redacted).toContain('[REDACTED_OPENAI_KEY]');
        expect(redacted).not.toContain('sk-1234567890abcdefABCDEF');
        expect(hits.openaiKey).toBe(1);
    });

    it('redacts GitHub PATs', () => {
        const { redacted, hits } = redactLogContent('using ghp_abcd1234XYZ for fetch');
        expect(redacted).toContain('[REDACTED_GITHUB_PAT]');
        expect(hits.githubPat).toBe(1);
    });

    it('redacts GitHub OAuth tokens (gho_)', () => {
        const { redacted, hits } = redactLogContent('cookie: gho_aB1cD2eF3gH4iJ5kL6');
        expect(redacted).toContain('[REDACTED_GITHUB_OAUTH]');
        expect(hits.githubOAuth).toBe(1);
    });

    it('redacts Google API keys (AIza-prefixed, 35 trailing chars)', () => {
        const key = 'AIza' + 'A'.repeat(35);
        const { redacted, hits } = redactLogContent(`key: ${key}`);
        expect(redacted).toContain('[REDACTED_GOOGLE_API_KEY]');
        expect(hits.googleApiKey).toBe(1);
    });

    it('redacts Authorization Bearer tokens', () => {
        const { redacted, hits } = redactLogContent(
            'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        );
        expect(redacted).toContain('Bearer [REDACTED_BEARER_TOKEN]');
        expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
        expect(hits.bearerToken).toBe(1);
    });

    it('redacts Windows user paths (preserves the C:\\Users\\ prefix)', () => {
        const { redacted } = redactLogContent(
            'Loaded model at C:\\Users\\alice\\models\\whisper.bin',
        );
        expect(redacted).toContain('C:\\Users\\[REDACTED_USER]');
        expect(redacted).not.toContain('C:\\Users\\alice');
        // Path tail beyond the username must survive unredacted.
        expect(redacted).toContain('models\\whisper.bin');
    });

    it('redacts macOS user paths', () => {
        const { redacted } = redactLogContent(
            'PCM at /Users/bob/Library/com.classnoteai/audio/x.pcm',
        );
        expect(redacted).toContain('/Users/[REDACTED_USER]');
        expect(redacted).not.toContain('/Users/bob');
    });

    it('redacts Linux home paths', () => {
        const { redacted } = redactLogContent('cwd: /home/dev/project/file.log');
        expect(redacted).toContain('/home/[REDACTED_USER]');
    });

    it('redacts MULTIPLE distinct categories in one pass', () => {
        const input = [
            'sk-aaaa1111',
            'ghp_bbbb2222',
            'C:\\Users\\charlie\\app',
            'Authorization: Bearer eyJ',
        ].join(' | ');
        const { redacted, hits } = redactLogContent(input);
        expect(hits.openaiKey).toBe(1);
        expect(hits.githubPat).toBe(1);
        expect(hits.windowsUserPath).toBe(1);
        expect(hits.bearerToken).toBe(1);
        // No leakage left.
        expect(redacted).not.toContain('sk-aaaa1111');
        expect(redacted).not.toContain('ghp_bbbb2222');
        expect(redacted).not.toContain('charlie');
        expect(redacted).not.toContain('eyJ');
    });

    it('returns input unchanged + empty hits when nothing matches', () => {
        const input = 'plain log line, no secrets here, just text.';
        const { redacted, hits } = redactLogContent(input);
        expect(redacted).toBe(input);
        expect(hits).toEqual({});
    });

    it('redacts ALL occurrences of the same pattern in a single pass', () => {
        const { hits } = redactLogContent('sk-AAAA sk-BBBB sk-CCCC');
        expect(hits.openaiKey).toBe(3);
    });
});

describe('buildGithubIssueUrl', () => {
    it('returns a valid github issues/new URL with the snippet body-encoded', () => {
        const url = buildGithubIssueUrl('error: something broke', '0.6.0-alpha.10');
        expect(url).toMatch(
            /^https:\/\/github\.com\/sklonely\/ClassNoteAI\/issues\/new\?/,
        );

        const params = new URLSearchParams(url.split('?')[1]);
        const body = params.get('body')!;
        expect(body).toContain('App version: 0.6.0-alpha.10');
        expect(body).toContain('error: something broke');
    });

    it('falls back to "(empty)" when log snippet is empty', () => {
        const url = buildGithubIssueUrl('', '0.6.0');
        const body = new URLSearchParams(url.split('?')[1]).get('body')!;
        expect(body).toContain('(empty)');
    });

    it('embeds navigator.userAgent when available', () => {
        const url = buildGithubIssueUrl('x', '0.6.0');
        const body = new URLSearchParams(url.split('?')[1]).get('body')!;
        // jsdom advertises a userAgent string; just assert it's non-unknown.
        expect(body).toContain('User agent:');
        expect(body).not.toContain('User agent: unknown');
    });
});
