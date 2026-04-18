import { invoke } from '@tauri-apps/api/core';

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
      }>>('find_orphaned_recordings'),
      invoke<Array<{ id: string; title: string; date: string; course_id: string }>>(
        'list_orphaned_recording_lectures',
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
   *  lecture row to status='completed' with the new audio_path. */
  async recover(lectureId: string): Promise<string> {
    const audioDir = await invoke<string>('get_audio_dir');
    const sep = navigator.userAgent.includes('Windows') ? '\\' : '/';
    const finalPath = `${audioDir}${sep}lecture_${lectureId}_${Date.now()}.wav`;
    await invoke('finalize_recording', { lectureId, finalPath });
    await invoke('update_lecture_status', { id: lectureId, status: 'completed' });
    // Caller is expected to refresh any lecture lists / audio path
    // caches — we intentionally don't reach into storageService here
    // to keep this service dependency-free for tests.
    return finalPath;
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
