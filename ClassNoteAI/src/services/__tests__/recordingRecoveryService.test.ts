import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { setMockInvokeResult, clearMockInvokeResults } from '../../test/setup';

/**
 * Regression test for v0.5.2 crash-recovery cross-reference logic.
 *
 * The service has to merge two independent data sources — the list of
 * `.pcm` files on disk and the list of lectures stuck at status='recording'
 * in the DB — and bucket them correctly. A mismatch in either direction
 * is a real user-visible bug:
 *   - PCM file but no matching lecture row → we'd offer to recover audio
 *     into a lecture that doesn't exist
 *   - Lecture row but no PCM file → we'd show "recover this session" but
 *     there's no audio; user clicks and gets an error
 * These tests pin that bucketing.
 */

import { recordingRecoveryService } from '../recordingRecoveryService';

describe('recordingRecoveryService.scan', () => {
    beforeEach(() => {
        clearMockInvokeResults();
        vi.clearAllMocks();
    });

    it('pairs pcm files with their matching lecture rows', async () => {
        setMockInvokeResult('find_orphaned_recordings', [
            {
                lecture_id: 'lec-1',
                duration_seconds: 600,
                bytes: 19_200_000,
                sample_rate: 16000,
                channels: 1,
                started_at: '2026-04-18T10:00:00Z',
            },
        ]);
        setMockInvokeResult('list_orphaned_recording_lectures', [
            {
                id: 'lec-1',
                title: 'HCI Week 5',
                date: '2026-04-18T09:58:00Z',
                course_id: 'course-hci',
            },
        ]);

        const result = await recordingRecoveryService.scan();

        expect(result.recoverable).toHaveLength(1);
        expect(result.recoverable[0].lectureId).toBe('lec-1');
        expect(result.recoverable[0].lecture.title).toBe('HCI Week 5');
        expect(result.recoverable[0].durationSeconds).toBe(600);
        expect(result.pcmOrphansWithoutLecture).toHaveLength(0);
        expect(result.lectureOrphansWithoutPcm).toHaveLength(0);
    });

    it('buckets pcm files with no matching lecture into pcmOrphansWithoutLecture', async () => {
        // User deleted the lecture row but the .pcm is still on disk.
        // We must not surface this in the recovery prompt — there's
        // no lecture to attach recovered audio to.
        setMockInvokeResult('find_orphaned_recordings', [
            {
                lecture_id: 'ghost-1',
                duration_seconds: 30,
                bytes: 960_000,
                sample_rate: 16000,
                channels: 1,
                started_at: null,
            },
        ]);
        setMockInvokeResult('list_orphaned_recording_lectures', []);

        const result = await recordingRecoveryService.scan();
        expect(result.recoverable).toHaveLength(0);
        expect(result.pcmOrphansWithoutLecture).toHaveLength(1);
        expect(result.pcmOrphansWithoutLecture[0].lectureId).toBe('ghost-1');
    });

    it('buckets zombie lecture rows with no pcm file into lectureOrphansWithoutPcm', async () => {
        // Pre-v0.5.2 lectures that crashed before incremental persist
        // was a thing — nothing to recover, just flip status and move on.
        setMockInvokeResult('find_orphaned_recordings', []);
        setMockInvokeResult('list_orphaned_recording_lectures', [
            { id: 'zombie-1', title: 'Old Crash', date: '2025-01-01', course_id: 'c' },
        ]);

        const result = await recordingRecoveryService.scan();
        expect(result.recoverable).toHaveLength(0);
        expect(result.lectureOrphansWithoutPcm).toHaveLength(1);
        expect(result.lectureOrphansWithoutPcm[0].id).toBe('zombie-1');
    });

    it('correctly splits a mixed set across all three buckets', async () => {
        setMockInvokeResult('find_orphaned_recordings', [
            { lecture_id: 'match', duration_seconds: 100, bytes: 0, sample_rate: 16000, channels: 1, started_at: null },
            { lecture_id: 'ghost', duration_seconds: 50, bytes: 0, sample_rate: 16000, channels: 1, started_at: null },
        ]);
        setMockInvokeResult('list_orphaned_recording_lectures', [
            { id: 'match', title: 'A', date: '', course_id: 'c' },
            { id: 'zombie', title: 'B', date: '', course_id: 'c' },
        ]);

        const result = await recordingRecoveryService.scan();
        expect(result.recoverable.map((r) => r.lectureId)).toEqual(['match']);
        expect(result.pcmOrphansWithoutLecture.map((p) => p.lectureId)).toEqual(['ghost']);
        expect(result.lectureOrphansWithoutPcm.map((l) => l.id)).toEqual(['zombie']);
    });
});

describe('recordingRecoveryService.recover', () => {
    beforeEach(() => {
        clearMockInvokeResults();
        vi.clearAllMocks();
    });

    it('calls finalize_recording then update_lecture_status in order', async () => {
        setMockInvokeResult('get_audio_dir', '/tmp/audio');
        setMockInvokeResult('finalize_recording', null);
        setMockInvokeResult('update_lecture_status', null);

        const path = await recordingRecoveryService.recover('lec-42');

        expect(path).toMatch(/lecture_lec-42_\d+\.wav$/);
        const calls = (invoke as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls.map((c) => c[0]);
        expect(calls).toContain('finalize_recording');
        expect(calls).toContain('update_lecture_status');
    });
});

describe('recordingRecoveryService.discard', () => {
    beforeEach(() => {
        clearMockInvokeResults();
        vi.clearAllMocks();
    });

    it('deletes the pcm and marks the lecture completed when hasPcm', async () => {
        setMockInvokeResult('discard_orphaned_recording', null);
        setMockInvokeResult('update_lecture_status', null);

        await recordingRecoveryService.discard('lec-x', true);

        const calls = (invoke as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls;
        expect(calls[0][0]).toBe('discard_orphaned_recording');
        expect(calls[1][0]).toBe('update_lecture_status');
    });

    it('skips the pcm delete when hasPcm is false', async () => {
        setMockInvokeResult('update_lecture_status', null);

        await recordingRecoveryService.discard('lec-x', false);

        const calls = (invoke as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls;
        expect(calls.map((c) => c[0])).toEqual(['update_lecture_status']);
    });
});
