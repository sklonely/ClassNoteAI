import type { SpeakerRole } from '../types/subtitle';

export interface SpeakerLabel {
  text: string;
  className: string;
}

export function buildSpeakerLabel(
  role: SpeakerRole | undefined,
  speakerId?: string,
): SpeakerLabel | null {
  const resolvedRole = role ?? 'unknown';
  if (resolvedRole === 'teacher') {
    return {
      text: 'Teacher',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:border-emerald-800',
    };
  }
  if (resolvedRole === 'student') {
    return {
      text: speakerId ? `Student ${normalizeSpeakerId(speakerId)}` : 'Student',
      className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/25 dark:text-amber-300 dark:border-amber-800',
    };
  }
  if (speakerId) {
    return {
      text: `Speaker ${normalizeSpeakerId(speakerId)}`,
      className: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:border-slate-600',
    };
  }
  return null;
}

function normalizeSpeakerId(speakerId: string): string {
  return speakerId
    .replace(/^speaker[-_\s]*/i, '')
    .replace(/^s[-_\s]*/i, '')
    .trim()
    .toUpperCase();
}
