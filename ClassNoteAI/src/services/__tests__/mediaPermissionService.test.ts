/**
 * mediaPermissionService regression tests.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 2 §audioRecorder):
 *   - #94  permission-denied error must point at macOS / Windows system
 *          settings paths, NOT 瀏覽器設定. This is a native Tauri app, and
 *          the previous browser-style copy left users with no actionable
 *          breadcrumb when the system permission dialog had been declined.
 *          PR #111 accidentally regressed this back to a generic 系統設定
 *          line; the alpha.10 fixup commit (47c108e) restored the OS-specific
 *          breadcrumbs. This test locks them in.
 *   - DOMException name → friendly message mapping (NotFound / NotReadable /
 *     OverconstrainedError / AbortError / SecurityError + default passthrough)
 *   - isRecoverableDeviceSelectionError narrowing logic
 *
 * Pure function tests; no jsdom interactions needed.
 */

import { describe, it, expect } from 'vitest';
import { mediaPermissionService } from '../mediaPermissionService';

function makeDOMError(name: string, message = `${name} message`): Error {
    const e = new Error(message);
    e.name = name;
    return e;
}

describe('mediaPermissionService.normalizeMicrophoneError', () => {
    describe('regression #94 — OS-specific breadcrumbs in permission-denied message', () => {
        // PR #111 dropped these in its first cut; the fixup restored them.
        // If a future refactor wants to consolidate the message, it must
        // either (a) keep both OS path strings or (b) update this test
        // alongside a deliberate UX decision.
        it('NotAllowedError mentions BOTH macOS and Windows system-settings paths', () => {
            const out = mediaPermissionService.normalizeMicrophoneError(makeDOMError('NotAllowedError'));
            expect(out.message).toContain('macOS');
            expect(out.message).toContain('Windows');
            // macOS-specific breadcrumb
            expect(out.message).toContain('系統偏好設定');
            expect(out.message).toContain('安全性與隱私權');
            // Windows-specific breadcrumb
            expect(out.message).toContain('隱私權');
        });

        it('does NOT mention 瀏覽器 (this is a native app, not a browser)', () => {
            const out = mediaPermissionService.normalizeMicrophoneError(makeDOMError('NotAllowedError'));
            expect(out.message).not.toContain('瀏覽器');
        });

        it('SecurityError aliases NotAllowedError (same OS-path message)', () => {
            const allowed = mediaPermissionService.normalizeMicrophoneError(makeDOMError('NotAllowedError'));
            const security = mediaPermissionService.normalizeMicrophoneError(makeDOMError('SecurityError'));
            expect(security.message).toBe(allowed.message);
        });
    });

    describe('other DOMException name → friendly message mapping', () => {
        const cases: Array<[string, string]> = [
            ['NotFoundError', '未找到可用的麥克風設備'],
            ['NotReadableError', '麥克風設備無法訪問'],
            ['OverconstrainedError', '先前選取的麥克風已不可用'],
            ['AbortError', '麥克風初始化被中斷'],
        ];
        for (const [name, expectedFragment] of cases) {
            it(`${name} → message contains "${expectedFragment}"`, () => {
                const out = mediaPermissionService.normalizeMicrophoneError(makeDOMError(name));
                expect(out.message).toContain(expectedFragment);
            });
        }

        it('unknown DOMException name passes through unchanged', () => {
            const original = makeDOMError('SomeRandomError', 'underlying detail');
            const out = mediaPermissionService.normalizeMicrophoneError(original);
            // Fall-through returns the same error object, NOT a re-wrapped one.
            expect(out).toBe(original);
        });

        it('non-Error input wraps to a generic message', () => {
            const out = mediaPermissionService.normalizeMicrophoneError('string failure');
            expect(out).toBeInstanceOf(Error);
            expect(out.message).toBe('麥克風初始化失敗');
        });

        it('null input wraps to a generic message (defensive)', () => {
            const out = mediaPermissionService.normalizeMicrophoneError(null);
            expect(out).toBeInstanceOf(Error);
            expect(out.message).toBe('麥克風初始化失敗');
        });
    });
});

describe('mediaPermissionService.isRecoverableDeviceSelectionError', () => {
    // The recorder's fallback ("retry without exact deviceId") only fires for
    // these two error names. False positives waste a getUserMedia call;
    // false negatives leave the user stuck on a stale device.

    it('returns true for OverconstrainedError', () => {
        expect(
            mediaPermissionService.isRecoverableDeviceSelectionError(makeDOMError('OverconstrainedError')),
        ).toBe(true);
    });

    it('returns true for NotFoundError', () => {
        expect(
            mediaPermissionService.isRecoverableDeviceSelectionError(makeDOMError('NotFoundError')),
        ).toBe(true);
    });

    it('returns false for NotAllowedError (permission, NOT device-selection)', () => {
        expect(
            mediaPermissionService.isRecoverableDeviceSelectionError(makeDOMError('NotAllowedError')),
        ).toBe(false);
    });

    it('returns false for NotReadableError (device busy, NOT recoverable by retry)', () => {
        expect(
            mediaPermissionService.isRecoverableDeviceSelectionError(makeDOMError('NotReadableError')),
        ).toBe(false);
    });

    it('returns false for non-Error inputs', () => {
        expect(mediaPermissionService.isRecoverableDeviceSelectionError('OverconstrainedError')).toBe(false);
        expect(mediaPermissionService.isRecoverableDeviceSelectionError(null)).toBe(false);
        expect(mediaPermissionService.isRecoverableDeviceSelectionError(undefined)).toBe(false);
    });
});

describe('mediaPermissionService.isMicrophoneAccessSupported', () => {
    it('reports true when navigator.mediaDevices.getUserMedia exists', () => {
        // jsdom env in this test runner provides navigator.mediaDevices via
        // the jsdom default; assert the supported flow returns true.
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: () => Promise.resolve(new MediaStream()) },
        });
        expect(mediaPermissionService.isMicrophoneAccessSupported()).toBe(true);
    });

    it('reports false when navigator.mediaDevices is missing', () => {
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: undefined,
        });
        expect(mediaPermissionService.isMicrophoneAccessSupported()).toBe(false);
    });
});
