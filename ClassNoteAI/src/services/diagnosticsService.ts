import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { storageService } from "./storageService";
import { redactLogContent } from "./logDiagnostics";
import { resolveAudioPath } from "./audioPathService";

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
export async function revealZipInFileManager(zipPath: string): Promise<void> {
  const lastSeparator = Math.max(zipPath.lastIndexOf("/"), zipPath.lastIndexOf("\\"));
  const parent = lastSeparator > 0 ? zipPath.slice(0, lastSeparator) : zipPath;
  await openUrl(parent);
}
