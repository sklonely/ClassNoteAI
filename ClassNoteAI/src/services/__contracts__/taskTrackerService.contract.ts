/**
 * Task Tracker Service — type-only contract.
 *
 * Sprint 2 (Phase 7) introduces a unified background-task registry. Long-
 * running jobs (post-recording summarisation, vector indexing, exports)
 * register themselves here so the H18 "Tasks" tray can render real progress
 * and so logout / app-close flows can cancel them deterministically.
 *
 * This module is type-only.
 */

export type TaskKind = 'summarize' | 'index' | 'export';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface TaskTrackerEntry {
  id: string;
  kind: TaskKind;
  /** User-facing label, already localised by the caller. */
  label: string;
  /** Optional lecture association — drives "show in lecture" deeplinks. */
  lectureId?: string;
  /** 0..1 inclusive. Implementations should clamp out-of-range values. */
  progress: number;
  status: TaskStatus;
  /** Epoch ms when the task entered `queued` or `running`. */
  startedAt: number;
  error?: string;
}

export interface TaskStartInput {
  kind: TaskKind;
  label: string;
  lectureId?: string;
}

export interface TaskTrackerService {
  /** Register a new task. Returns the assigned task id. */
  start(input: TaskStartInput): string;

  /**
   * Patch fields on an existing task. Common pattern: `update(id, { progress })`
   * during a long pipeline. Implementations should ignore unknown ids rather
   * than throwing — UI code may race with completion.
   */
  update(taskId: string, patch: Partial<TaskTrackerEntry>): void;

  /** Mark task as `done` with `progress = 1`. */
  complete(taskId: string): void;

  /** Mark task as `failed` and record the error message. */
  fail(taskId: string, err: string): void;

  /** Mark task as `cancelled`. Does not actually abort the underlying work. */
  cancel(taskId: string): void;

  /** Snapshot of tasks whose status is `queued` or `running`. */
  getActive(): TaskTrackerEntry[];

  getById(taskId: string): TaskTrackerEntry | undefined;

  /** Subscribe to the full task list (active + recently terminal). */
  subscribe(cb: (tasks: TaskTrackerEntry[]) => void): () => void;

  /** TEST-ONLY — wipe all tasks and subscribers. */
  reset(): void;

  /**
   * Cancel every active task. Used by the logout flow and forced app close
   * to flip `running` tasks to `cancelled` in one pass.
   */
  cancelAll(): void;
}
