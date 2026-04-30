import { invoke } from '@tauri-apps/api/core';
import { authService } from './authService';

/**
 * Crash-recovery service for the incremental PCM persistence flow.
 *
 * The Rust backend writes raw audio to `{app_data}/audio/in-progress/{lecture_id}.pcm`
 * every ~5s during a recording (see audioRecorder.enablePersistence).
 * If the app dies before Stop, those files outlive the crash.
 *
 * On launch, App.tsx calls `findAll()`. For each entry, it prompts the
 * user to either recover (wrap the .pcm as WAV, mark the lecture
 * 'completed' with a real audio_path) or discard (delete the .pcm,
 * just flip status).
 *
 * Why a dedicated service rather than inlining into App.tsx: keeps the
 * UI flow simple (await + one method call per action), and makes the
 * cross-reference between DB rows and on-disk .pcm files unit-testable
 * without dragging the whole React tree into a test.
 */

export interface OrphanedRecording {
  lectureId: string;
  durationSeconds: number;
  bytes: number;
  sampleRate: number;
  channels: number;
  startedAt: string | null;
  /** Phase 1 of speech-pipeline-v0.6.5 (#52). Number of transcript
   *  segments that were captured to the JSONL sidecar before the crash.
   *  0 means the audio is recoverable but no live caption text was ever
   *  persisted (older builds, or a crash before the first commit). */
  transcriptSegments: number;
}

/** One row of an orphaned transcript JSONL — exact mirror of the Rust
 *  `PersistedTranscriptSegment` struct so the IPC payload is 1:1.
 *  Recovery uses these to rebuild the `subtitles` rows for a recovered
 *  lecture before flipping its status to 'completed'. */
export interface PersistedTranscriptSegment {
  id: string;
  timestamp: number;
  text_en: string;
  text_zh?: string;
  type: 'rough' | 'fine';
}

export interface OrphanedLecture {
  id: string;
  title: string;
  date: string;
  courseId: string;
}

/** Combined view: a recoverable session needs BOTH a DB row (so we know
 *  what lecture it belongs to) AND a .pcm file on disk (so there's
 *  actual audio to recover). Either side alone just needs cleanup. */
export interface RecoverableSession extends OrphanedRecording {
  lecture: OrphanedLecture;
}

class RecordingRecoveryService {
  /** Scan disk + DB for everything in need of attention. The three
   *  buckets are mutually exclusive. */
  async scan(): Promise<{
    recoverable: RecoverableSession[];
    pcmOrphansWithoutLecture: OrphanedRecording[];
    lectureOrphansWithoutPcm: OrphanedLecture[];
  }> {
    // allSettled (not all): if one side throws (e.g. the DB is briefly
    // locked on launch), we can still process whichever side succeeded.
    // Losing half the information is better than surfacing zero recovery
    // options when recovery is the whole point of this code path.
    const [pcmSettled, lectureSettled] = await Promise.allSettled([
      invoke<Array<{
        lecture_id: string;
        duration_seconds: number;
        bytes: number;
        sample_rate: number;
        channels: number;
        started_at: string | null;
        transcript_segments?: number;
      }>>('find_orphaned_recordings'),
      invoke<Array<{ id: string; title: string; date: string; course_id: string }>>(
        'list_orphaned_recording_lectures',
        {
          // cp75.7: scope orphan list to the current user so we don't
          // surface another account's mid-crash recording as a recovery
          // candidate (would attach the recording to whoever clicks).
          userId: authService.getUser()?.username || 'default_user',
        },
      ),
    ]);
    const pcmRaw =
      pcmSettled.status === 'fulfilled'
        ? pcmSettled.value
        : (console.warn('[recovery] find_orphaned_recordings failed:', pcmSettled.reason), []);
    const lectureRaw =
      lectureSettled.status === 'fulfilled'
        ? lectureSettled.value
        : (console.warn('[recovery] list_orphaned_recording_lectures failed:', lectureSettled.reason), []);

    const pcmById = new Map<string, OrphanedRecording>();
    for (const p of pcmRaw) {
      pcmById.set(p.lecture_id, {
        lectureId: p.lecture_id,
        durationSeconds: p.duration_seconds,
        bytes: p.bytes,
        sampleRate: p.sample_rate,
        channels: p.channels,
        startedAt: p.started_at,
        transcriptSegments: p.transcript_segments ?? 0,
      });
    }

    const lectureById = new Map<string, OrphanedLecture>();
    for (const l of lectureRaw) {
      lectureById.set(l.id, {
        id: l.id,
        title: l.title,
        date: l.date,
        courseId: l.course_id,
      });
    }

    const recoverable: RecoverableSession[] = [];
    const pcmOrphansWithoutLecture: OrphanedRecording[] = [];
    const lectureOrphansWithoutPcm: OrphanedLecture[] = [];

    for (const [id, pcm] of pcmById) {
      const lec = lectureById.get(id);
      if (lec) {
        recoverable.push({ ...pcm, lecture: lec });
      } else {
        pcmOrphansWithoutLecture.push(pcm);
      }
    }
    for (const [id, lec] of lectureById) {
      if (!pcmById.has(id)) lectureOrphansWithoutPcm.push(lec);
    }

    return { recoverable, pcmOrphansWithoutLecture, lectureOrphansWithoutPcm };
  }

  /** Finalize a .pcm into a WAV under the audio dir, update the
   *  lecture row to status='completed' with the new audio_path.
   *
   *  Phase 1 of speech-pipeline-v0.6.5 (#52): also import the transcript
   *  JSONL sidecar (if any) into the `subtitles` table BEFORE the
   *  finalize, so a failure between transcript-import and finalize
   *  leaves the JSONL intact for a retry on the next launch. */
  async recover(lectureId: string): Promise<string> {
    const audioDir = await invoke<string>('get_audio_dir');
    const sep = navigator.userAgent.includes('Windows') ? '\\' : '/';
    const finalPath = `${audioDir}${sep}lecture_${lectureId}_${Date.now()}.wav`;

    // 1. Import transcript JSONL into sqlite. If this throws (e.g. the
    //    save_subtitles command rejects a row), we abort and let the
    //    user retry — the audio + JSONL stay on disk, the lecture row
    //    stays at status='recording'.
    await this.recoverTranscript(lectureId);

    // 2. Wrap PCM as WAV at the canonical audio path. Removes .pcm and
    //    .meta.json; transcript JSONL is intentionally retained.
    await invoke('finalize_recording', { lectureId, finalPath });

    // 3. Now that audio is canonical and transcript is in sqlite, the
    //    JSONL sidecar is redundant — remove it.
    try {
      await invoke('discard_orphaned_transcript', { lectureId });
    } catch (err) {
      // Non-fatal: the file is harmless on disk and a future scan will
      // see no .pcm so it'll never be offered for recovery again.
      console.warn(
        `[recovery] post-recovery transcript JSONL cleanup failed for ${lectureId}:`,
        err,
      );
    }

    await invoke('update_lecture_status', { id: lectureId, status: 'completed' });
    // Caller is expected to refresh any lecture lists / audio path
    // caches — we intentionally don't reach into storageService here
    // to keep this service dependency-free for tests.
    return finalPath;
  }

  /** Read the transcript JSONL (if any) and insert each segment into
   *  sqlite via `save_subtitles`. Idempotent: if a row with the same
   *  id already exists, the storage command is expected to upsert.
   *
   *  Public so tests / advanced UI flows can call it without going
   *  through the full `recover()` path. */
  async recoverTranscript(lectureId: string): Promise<number> {
    const segments = await invoke<PersistedTranscriptSegment[]>(
      'read_orphaned_transcript',
      { lectureId },
    ).catch((err) => {
      // Empty result is fine; only treat IPC failure as a problem.
      console.warn(
        `[recovery] read_orphaned_transcript failed for ${lectureId}:`,
        err,
      );
      return [] as PersistedTranscriptSegment[];
    });
    // Defensive: a mock harness or unstubbed Tauri command can resolve
    // with `null` / `undefined` even though the Rust signature returns
    // `Vec<...>`. Treat both the same as "no transcript on disk".
    if (!segments || segments.length === 0) return 0;

    // De-dup: a segment may appear twice (rough-only line followed by
    // rough+text_zh line). Last entry per id wins — that's the most
    // up-to-date version of the row.
    const dedup = new Map<string, PersistedTranscriptSegment>();
    for (const seg of segments) dedup.set(seg.id, seg);

    // Avoid a hard `storageService` import here so unit tests can mock
    // the IPC layer directly without dragging the full storage module.
    const subtitles = Array.from(dedup.values()).map((seg) => ({
      id: seg.id,
      lecture_id: lectureId,
      timestamp: seg.timestamp,
      text_en: seg.text_en,
      text_zh: seg.text_zh ?? null,
      type: seg.type,
    }));
    // cp75.21 — pass userId so the Rust side can verify ownership of
    // the lecture before persisting these recovered rows.
    const userId = authService.getUser()?.username || 'default_user';
    await invoke('save_subtitles', { subtitles, userId });
    return subtitles.length;
  }

  /** Delete the .pcm + meta sidecar without wrapping. Also flips the
   *  lecture row to 'completed' so the user isn't prompted again. */
  async discard(lectureId: string, hasPcm: boolean): Promise<void> {
    if (hasPcm) {
      await invoke('discard_orphaned_recording', { lectureId });
    }
    await invoke('update_lecture_status', { id: lectureId, status: 'completed' });
  }

  /** For pcm orphans without a lecture row: the `.pcm` file references
   *  a lecture that no longer exists (user deleted it mid-record?) —
   *  safe to discard unconditionally, no DB change needed. */
  async discardOrphanPcm(lectureId: string): Promise<void> {
    await invoke('discard_orphaned_recording', { lectureId });
  }
}

export const recordingRecoveryService = new RecordingRecoveryService();
