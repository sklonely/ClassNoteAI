import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { storageService } from "./storageService";
import { redactLogContent } from "./logDiagnostics";

const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

interface DiagnosticPackageInput {
  lecture_meta_json: string;
  subtitles_json: string;
  audio_path: string | null;
  redacted_log_text: string;
  metadata_json: string;
}

export interface DiagnosticExportOptions {
  lectureId: string;
  includeAudio: boolean;
  appVersion: string;
  buildVariant: string;
}

function joinPath(baseDir: string, childPath: string, separator: string): string {
  const normalizedBase = baseDir.replace(/[\\/]+$/, "");
  const normalizedChild = childPath.replace(/^[\\/]+/, "").replace(/[\\/]+/g, separator);
  return `${normalizedBase}${separator}${normalizedChild}`;
}

export async function exportDiagnosticPackage(
  opts: DiagnosticExportOptions,
): Promise<string> {
  const lecture = await storageService.getLecture(opts.lectureId);
  if (!lecture) {
    throw new Error(`Lecture not found: ${opts.lectureId}`);
  }

  const subtitles = await storageService.getSubtitles(opts.lectureId);
  const audioPath = opts.includeAudio
    ? await resolveAudioPath(lecture.audio_path)
    : null;

  const rawLog = await invoke<string>("read_recent_log", { lines: 2000 });
  const { redacted } = redactLogContent(rawLog);
  const metadata = {
    app_version: opts.appVersion,
    build_variant: opts.buildVariant,
    os: navigator.userAgent,
    exported_at: new Date().toISOString(),
    lecture_id: opts.lectureId,
    has_audio: audioPath !== null,
  };

  const input: DiagnosticPackageInput = {
    lecture_meta_json: JSON.stringify(lecture),
    subtitles_json: JSON.stringify(subtitles),
    audio_path: audioPath,
    redacted_log_text: redacted,
    metadata_json: JSON.stringify(metadata),
  };

  return await invoke<string>("export_diagnostic_package", {
    input,
    includeAudio: opts.includeAudio,
  });
}

export async function resolveAudioPath(
  stored: string | null | undefined,
): Promise<string | null> {
  if (!stored) {
    return null;
  }

  const trimmed = stored.trim();
  if (!trimmed) {
    return null;
  }

  const [{ readFile }, { sep }] = await Promise.all([
    import("@tauri-apps/plugin-fs"),
    import("@tauri-apps/api/path"),
  ]);
  const audioDir = await invoke<string>("get_audio_dir");
  const candidate = ABSOLUTE_PATH_PATTERN.test(trimmed)
    ? trimmed
    : joinPath(audioDir, trimmed, sep());

  try {
    await readFile(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export async function revealZipInFileManager(zipPath: string): Promise<void> {
  const lastSeparator = Math.max(zipPath.lastIndexOf("/"), zipPath.lastIndexOf("\\"));
  const parent = lastSeparator > 0 ? zipPath.slice(0, lastSeparator) : zipPath;
  await openUrl(parent);
}
