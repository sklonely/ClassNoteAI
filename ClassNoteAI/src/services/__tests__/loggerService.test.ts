/**
 * loggerService regression tests · Phase 7 W19.
 *
 * Coverage targets:
 *   - W19: Global console wrapper must redact API keys / Bearer tokens
 *          / api_key= patterns BEFORE they hit DevTools or piped stdout.
 *          Runtime log was previously unfiltered; only the export-bundle
 *          pipeline ran the redact pass. Open DevTools → leak.
 *   - install/uninstall must be idempotent and reversible (test cleanup).
 *
 * Pure-ish: spies on `console` for capture; no jsdom-specific APIs.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    DEFAULT_PATTERNS,
    redactString,
    redactArg,
    installConsoleRedaction,
    uninstallConsoleRedaction,
    __isInstalled,
} from '../loggerService';

afterEach(() => {
    // Always restore console between tests so suite isolation holds.
    uninstallConsoleRedaction();
    vi.restoreAllMocks();
});

describe('redactString — pattern coverage', () => {
    it('redacts Anthropic sk-ant- keys', () => {
        const out = redactString('key=sk-ant-abcdefghijklmnopqrstuv12345');
        expect(out).toContain('[REDACTED]');
        expect(out).not.toContain('sk-ant-abcdefghijklmnopqrstuv12345');
    });

    it('redacts OpenAI / generic sk- keys (>=20 chars body)', () => {
        const out = redactString('OPENAI=sk-1234567890abcdefABCDEF');
        expect(out).toContain('[REDACTED]');
        expect(out).not.toContain('sk-1234567890abcdefABCDEF');
    });

    it('redacts long Bearer tokens', () => {
        const out = redactString(
            'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload',
        );
        expect(out).toContain('[REDACTED]');
        expect(out).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload');
    });

    it('does NOT mangle short non-secret strings (status code, version)', () => {
        const safe = 'status: 200, version: 1.2.3, route=/foo';
        const out = redactString(safe);
        expect(out).toBe(safe);
    });

    it('redacts api_key=... pattern', () => {
        const out = redactString('config: api_key=abcdef1234567890XYZ');
        expect(out).toContain('[REDACTED]');
        expect(out).not.toContain('abcdef1234567890XYZ');
    });
});

describe('redactArg — type-aware redaction', () => {
    it('redacts string args', () => {
        const out = redactArg('leak: sk-ant-abcdefghijklmnopqrstuv99999');
        expect(typeof out).toBe('string');
        expect(out as string).toContain('[REDACTED]');
    });

    it('redacts secrets nested inside objects (deep, via JSON round-trip)', () => {
        const obj = {
            user: 'alice',
            headers: {
                Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload',
            },
            apiKey: 'sk-ant-abcdefghijklmnopqrstuvWXYZ12',
        };
        const out = redactArg(obj) as Record<string, unknown>;
        const serialized = JSON.stringify(out);
        expect(serialized).toContain('[REDACTED]');
        expect(serialized).not.toContain('sk-ant-abcdefghijklmnopqrstuvWXYZ12');
        expect(serialized).not.toContain(
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload',
        );
        // Non-secret fields preserved.
        expect(serialized).toContain('alice');
    });

    it('returns Error instances unchanged (preserves stack for source map debug)', () => {
        const err = new Error('boom: sk-ant-shouldnotredactstack0000000');
        const out = redactArg(err);
        expect(out).toBe(err); // identity preserved
    });

    it('returns object reference unchanged when nothing matches (identity preserved)', () => {
        const obj = { a: 1, b: 'plain text' };
        const out = redactArg(obj);
        expect(out).toBe(obj);
    });

    it('default-pattern guard exists and is non-empty', () => {
        expect(Array.isArray(DEFAULT_PATTERNS)).toBe(true);
        expect(DEFAULT_PATTERNS.length).toBeGreaterThan(0);
    });
});

describe('installConsoleRedaction / uninstallConsoleRedaction', () => {
    it('after install, console.log args are redacted before reaching the real impl', () => {
        const realLog = vi.spyOn(console, 'log').mockImplementation(() => {});
        installConsoleRedaction();
        // After install, console.log is replaced by our wrapper,
        // but the wrapper internally calls the captured `originalConsole.log`,
        // which is the spy we just installed.
        console.log('leak: sk-ant-abcdefghijklmnopqrstuv55555');
        expect(realLog).toHaveBeenCalledTimes(1);
        const firstArg = realLog.mock.calls[0][0];
        expect(typeof firstArg).toBe('string');
        expect(firstArg as string).toContain('[REDACTED]');
        expect(firstArg as string).not.toContain(
            'sk-ant-abcdefghijklmnopqrstuv55555',
        );
    });

    it('uninstall restores original console behavior', () => {
        const realLog = vi.spyOn(console, 'log').mockImplementation(() => {});
        installConsoleRedaction();
        expect(__isInstalled()).toBe(true);

        uninstallConsoleRedaction();
        expect(__isInstalled()).toBe(false);

        // After uninstall, console.log should pass strings through verbatim.
        console.log('sk-ant-abcdefghijklmnopqrstuv77777');
        expect(realLog).toHaveBeenCalledTimes(1);
        expect(realLog.mock.calls[0][0]).toBe(
            'sk-ant-abcdefghijklmnopqrstuv77777',
        );
    });

    it('install is idempotent (second call is a no-op)', () => {
        installConsoleRedaction();
        const wrappedRef = console.log;
        installConsoleRedaction(); // second call
        expect(console.log).toBe(wrappedRef); // same wrapper, not re-wrapped
        expect(__isInstalled()).toBe(true);
    });

    it('wraps all five console methods (log/info/warn/error/debug)', () => {
        const spies = {
            log: vi.spyOn(console, 'log').mockImplementation(() => {}),
            info: vi.spyOn(console, 'info').mockImplementation(() => {}),
            warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
            error: vi.spyOn(console, 'error').mockImplementation(() => {}),
            debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
        };
        installConsoleRedaction();
        const secret = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload';
        console.log(secret);
        console.info(secret);
        console.warn(secret);
        console.error(secret);
        console.debug(secret);

        for (const key of ['log', 'info', 'warn', 'error', 'debug'] as const) {
            expect(spies[key]).toHaveBeenCalledTimes(1);
            expect(spies[key].mock.calls[0][0]).toContain('[REDACTED]');
            expect(spies[key].mock.calls[0][0]).not.toContain(
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload',
            );
        }
    });
});
