import { describe, expect, it } from 'vitest';
import { buildInterruptedRecordingNotice } from '../recordingInterruptionNotice';

describe('recordingInterruptionNotice', () => {
  it('returns null when there are no interrupted lectures', () => {
    expect(buildInterruptedRecordingNotice([])).toBeNull();
  });

  it('builds a readable notice for one interrupted lecture', () => {
    const notice = buildInterruptedRecordingNotice([
      { id: 'lec-1', title: '線代第八週', date: '2026-04-20', courseId: 'course-1' },
    ]);

    expect(notice).toEqual({
      message: '上次有錄音異常中斷',
      detail:
        '「線代第八週」 在 app 異常關閉前沒有成功寫出可恢復音訊。課堂已退出錄音狀態，建議重新開一堂課再錄，以免誤以為這段音訊仍可找回。',
    });
  });

  it('summarizes multiple interrupted lectures without listing them all', () => {
    const notice = buildInterruptedRecordingNotice([
      { id: 'lec-1', title: 'A', date: '2026-04-20', courseId: 'course-1' },
      { id: 'lec-2', title: 'B', date: '2026-04-20', courseId: 'course-1' },
      { id: 'lec-3', title: 'C', date: '2026-04-20', courseId: 'course-1' },
    ]);

    expect(notice?.detail).toContain('「A」');
    expect(notice?.detail).toContain('「B」');
    expect(notice?.detail).toContain('等 3 堂課');
  });
});
