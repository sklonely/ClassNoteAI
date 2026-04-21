import type { OrphanedLecture } from './recordingRecoveryService';

export interface RecordingInterruptionNotice {
  message: string;
  detail: string;
}

function formatLectureLabel(lecture: OrphanedLecture): string {
  const title = lecture.title?.trim() || '未命名課堂';
  return `「${title}」`;
}

export function buildInterruptedRecordingNotice(
  lectures: OrphanedLecture[],
): RecordingInterruptionNotice | null {
  if (lectures.length === 0) return null;

  const preview = lectures.slice(0, 2).map(formatLectureLabel).join('、');
  const remainder = lectures.length - Math.min(lectures.length, 2);
  const suffix = remainder > 0 ? ` 等 ${lectures.length} 堂課` : '';

  return {
    message: '上次有錄音異常中斷',
    detail:
      `${preview}${suffix} 在 app 異常關閉前沒有成功寫出可恢復音訊。` +
      '課堂已退出錄音狀態，建議重新開一堂課再錄，以免誤以為這段音訊仍可找回。',
  };
}
