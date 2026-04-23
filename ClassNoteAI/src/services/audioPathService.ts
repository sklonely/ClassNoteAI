import { invoke } from '@tauri-apps/api/core';
import { exists } from '@tauri-apps/plugin-fs';
import type { Lecture } from '../types';

const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

function stripLeadingPathSeparators(value: string): string {
  return value.replace(/^[\\/]+/, '');
}

function stripTrailingPathSeparators(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function normalizePathSeparators(value: string): string {
  return value.replace(/[\\/]+/g, '/');
}

function normalizeStoredAudioPath(storedPath: string | null | undefined): string | null {
  if (!storedPath) {
    return null;
  }

  const trimmedPath = storedPath.trim();
  return trimmedPath.length > 0 ? trimmedPath : null;
}

export function joinAudioPath(baseDir: string, childPath: string): string {
  const separator = baseDir.includes('\\') ? '\\' : '/';
  const normalizedChild = stripLeadingPathSeparators(childPath).replace(/[\\/]+/g, separator);
  return `${stripTrailingPathSeparators(baseDir)}${separator}${normalizedChild}`;
}

export function toRelativeAudioPath(audioDir: string, absolutePath: string): string {
  const normalizedDir = normalizePathSeparators(stripTrailingPathSeparators(audioDir));
  const normalizedPath = normalizePathSeparators(absolutePath);

  if (normalizedPath.startsWith(`${normalizedDir}/`)) {
    return normalizedPath.slice(normalizedDir.length + 1);
  }

  const filename = absolutePath.split(/[\\/]/).pop();
  return filename && filename.length > 0 ? filename : absolutePath;
}

export async function resolveAudioPath(
  storedPath: string | null | undefined,
  audioDirOverride?: string,
): Promise<string | null> {
  const trimmedPath = normalizeStoredAudioPath(storedPath);
  if (!trimmedPath) {
    return null;
  }

  const audioDir = audioDirOverride ?? await invoke<string>('get_audio_dir');
  const resolvedPath = ABSOLUTE_PATH_PATTERN.test(trimmedPath)
    ? trimmedPath
    : joinAudioPath(audioDir, trimmedPath);

  try {
    return await exists(resolvedPath) ? resolvedPath : null;
  } catch {
    return null;
  }
}

export async function recoverAudioPath(lectureId: string): Promise<string | null> {
  return await invoke<string | null>('try_recover_audio_path', { lectureId });
}

export async function resolveOrRecoverAudioPath(
  lectureId: string,
  storedPath: string | null | undefined,
): Promise<{
  resolvedPath: string | null;
  storedPath: string | null;
  recovered: boolean;
}> {
  const normalizedStoredPath = normalizeStoredAudioPath(storedPath);
  const resolvedExistingPath = await resolveAudioPath(normalizedStoredPath);
  if (resolvedExistingPath) {
    return {
      resolvedPath: resolvedExistingPath,
      storedPath: normalizedStoredPath,
      recovered: false,
    };
  }

  const recoveredStoredPath = normalizeStoredAudioPath(await recoverAudioPath(lectureId));
  if (!recoveredStoredPath) {
    return {
      resolvedPath: null,
      storedPath: normalizedStoredPath,
      recovered: false,
    };
  }

  return {
    resolvedPath: await resolveAudioPath(recoveredStoredPath),
    storedPath: recoveredStoredPath,
    recovered: recoveredStoredPath !== normalizedStoredPath,
  };
}

export interface AudioLinkAuditResult {
  recoveredLectureIds: string[];
  unresolvedLectureIds: string[];
}

export async function auditCompletedLectureAudioLinks(
  lectures: Lecture[],
): Promise<AudioLinkAuditResult> {
  const recoveredLectureIds: string[] = [];
  const unresolvedLectureIds: string[] = [];

  for (const lecture of lectures) {
    if (lecture.status !== 'completed' || lecture.video_path) {
      continue;
    }

    const storedPath = normalizeStoredAudioPath(lecture.audio_path);
    if (storedPath && await resolveAudioPath(storedPath)) {
      continue;
    }

    const recoveredPath = normalizeStoredAudioPath(await recoverAudioPath(lecture.id));
    if (recoveredPath && await resolveAudioPath(recoveredPath)) {
      recoveredLectureIds.push(lecture.id);
      continue;
    }

    // Null/empty audio_path is ambiguous — the lecture may genuinely be
    // text-only. We only flag unresolved rows that already pointed at a
    // concrete (but broken) file path.
    if (storedPath) {
      unresolvedLectureIds.push(lecture.id);
    }
  }

  return {
    recoveredLectureIds,
    unresolvedLectureIds,
  };
}
