/**
 * audioRecorder fallback-path regression tests.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 2
 * §audioRecorder):
 *   - #99  saved deviceId fails with OverconstrainedError / NotFoundError
 *          → fallback to system default → ONE toast → second getUserMedia
 *   - #94 (already locked in mediaPermissionService.test.ts)
 *   - NotAllowedError → no fallback, throws normalized error
 *   - missing navigator.mediaDevices → throws clear "瀏覽器不支持..." error
 *   - toast warning fires only ONCE per recorder instance even on
 *     repeated fallbacks
 *
 * We bracket-access the private getMediaStream to isolate the fallback
 * logic from start()'s AudioContext + ScriptProcessor wiring (which
 * jsdom can't run).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioRecorder } from '../audioRecorder';

vi.mock('../toastService', () => ({
    toastService: {
        warning: vi.fn(),
    },
}));

import { toastService } from '../toastService';
const mockedToast = vi.mocked(toastService);

function makeError(name: string, message = `${name}`): Error {
    const e = new Error(message);
    e.name = name;
    return e;
}

function fakeMediaStream(): MediaStream {
    return {
        getAudioTracks: () => [
            {
                getSettings: () => ({
                    deviceId: 'resolved-device',
                    sampleRate: 48000,
                    channelCount: 1,
                }),
                label: 'Fake Mic',
            },
        ],
    } as unknown as MediaStream;
}

const getUserMedia = vi.fn();
const enumerateDevices = vi.fn(() => Promise.resolve([]));
const addEventListener = vi.fn();
const removeEventListener = vi.fn();

beforeEach(() => {
    getUserMedia.mockReset();
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true,
        value: {
            getUserMedia,
            enumerateDevices,
            addEventListener,
            removeEventListener,
        },
    });
});

afterEach(() => {
    // Restore so other tests in the suite don't see our shimmed mediaDevices.
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true,
        value: undefined,
    });
});

function callPrivate(recorder: AudioRecorder): Promise<MediaStream> {
    return (recorder as unknown as {
        getMediaStream(): Promise<MediaStream>;
    }).getMediaStream();
}

describe('AudioRecorder.getMediaStream — fallback path (regression #99)', () => {
    it('saved deviceId works → getUserMedia called once with exact constraint', async () => {
        getUserMedia.mockResolvedValueOnce(fakeMediaStream());

        const rec = new AudioRecorder({ deviceId: 'saved-mic' });
        const stream = await callPrivate(rec);
        expect(stream).toBeTruthy();
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        const constraints = getUserMedia.mock.calls[0][0];
        expect(constraints.audio.deviceId).toEqual({ exact: 'saved-mic' });
        expect(mockedToast.warning).not.toHaveBeenCalled();
    });

    it('saved deviceId throws OverconstrainedError → fallback to default + ONE toast', async () => {
        getUserMedia
            .mockRejectedValueOnce(makeError('OverconstrainedError'))
            .mockResolvedValueOnce(fakeMediaStream());

        const rec = new AudioRecorder({ deviceId: 'gone-mic' });
        const stream = await callPrivate(rec);
        expect(stream).toBeTruthy();
        // Two getUserMedia calls: first failing exact, then fallback without exact.
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        const fallbackConstraints = getUserMedia.mock.calls[1][0];
        expect(fallbackConstraints.audio.deviceId).toBeUndefined();
        expect(mockedToast.warning).toHaveBeenCalledTimes(1);
        expect(mockedToast.warning).toHaveBeenCalledWith(
            expect.stringContaining('系統預設麥克風'),
        );
    });

    it('saved deviceId throws NotFoundError → fallback to default + ONE toast', async () => {
        getUserMedia
            .mockRejectedValueOnce(makeError('NotFoundError'))
            .mockResolvedValueOnce(fakeMediaStream());

        const rec = new AudioRecorder({ deviceId: 'unplugged-mic' });
        await callPrivate(rec);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(mockedToast.warning).toHaveBeenCalledTimes(1);
    });

    it('NotAllowedError → no fallback, throws normalized error mentioning system settings', async () => {
        getUserMedia.mockRejectedValueOnce(makeError('NotAllowedError'));
        const rec = new AudioRecorder({ deviceId: 'whatever' });
        await expect(callPrivate(rec)).rejects.toThrow(/系統設定/);
        // Critical: NO fallback attempt should fire (permission denial isn't recoverable by retry).
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(mockedToast.warning).not.toHaveBeenCalled();
    });

    it('toast warning fires only ONCE per recorder instance across repeated fallbacks', async () => {
        // First call: fallback (toast +1)
        getUserMedia
            .mockRejectedValueOnce(makeError('OverconstrainedError'))
            .mockResolvedValueOnce(fakeMediaStream());
        const rec = new AudioRecorder({ deviceId: 'gone' });
        await callPrivate(rec);
        expect(mockedToast.warning).toHaveBeenCalledTimes(1);

        // After the first fallback, the recorder cleared its saved deviceId
        // (so subsequent calls go straight to default). Reset getUserMedia
        // and call again — should NOT toast a second time.
        getUserMedia.mockReset();
        getUserMedia.mockResolvedValueOnce(fakeMediaStream());
        await callPrivate(rec);
        expect(mockedToast.warning).toHaveBeenCalledTimes(1);
    });

    it('missing navigator.mediaDevices → throws clear "音頻錄製 API" error', async () => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            configurable: true,
            value: undefined,
        });
        const rec = new AudioRecorder({ deviceId: 'whatever' });
        await expect(callPrivate(rec)).rejects.toThrow(/音頻錄製 API/);
    });

    it('no saved deviceId → calls getUserMedia once without exact constraint, no toast', async () => {
        getUserMedia.mockResolvedValueOnce(fakeMediaStream());
        const rec = new AudioRecorder({});
        await callPrivate(rec);
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(getUserMedia.mock.calls[0][0].audio.deviceId).toBeUndefined();
        expect(mockedToast.warning).not.toHaveBeenCalled();
    });
});
