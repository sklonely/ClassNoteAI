export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi'] as const;
export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'] as const;
export const SUPPORTED_MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] as const;

const VIDEO_EXTENSION_SET = new Set<string>(VIDEO_EXTENSIONS);
const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_EXTENSIONS);

export function getFileExtension(path: string): string | null {
  const match = /(?:^|[\\/])?[^\\/]*\.([^./\\]+)$/.exec(path.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export function isSupportedMediaPath(path: string): boolean {
  const ext = getFileExtension(path);
  return !!ext && (VIDEO_EXTENSION_SET.has(ext) || AUDIO_EXTENSION_SET.has(ext));
}

export function isAudioOnlyMediaPath(path: string): boolean {
  const ext = getFileExtension(path);
  return !!ext && AUDIO_EXTENSION_SET.has(ext);
}

export function mediaDialogExtensions(): string[] {
  return [...SUPPORTED_MEDIA_EXTENSIONS];
}
