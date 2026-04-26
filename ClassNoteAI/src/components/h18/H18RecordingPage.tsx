/**
 * H18RecordingPage · v0.7.0 Phase 6.5 (chrome wrap)
 *
 * 對應 docs/design/h18-deep/h18-recording-v2.jsx (RecordingPage)。
 *
 * 範圍誠實說明：這個 CP **不是**完整的 RV2 layout 重寫。原因是
 * NotesView 的 recording engine（AudioRecorder + Parakeet ASR +
 * accumulator + recordingDeviceMonitor + recordingRecoveryService +
 * 起停/暫停 state machine + crash recovery）在 NotesView 內部 1900+
 * 行緊耦合，硬拆 hook 容易回歸風險高（per memory feedback rule
 * "verification discipline" #1：not declare done without exercising
 * the actual code path）。
 *
 * 本 CP 範圍：
 *  - 把 lecture.status === 'recording' 的路徑導到本元件
 *  - H18 風格的 LIVE banner（紅色 pulse）+ 返回鍵
 *  - 主體 host = legacy NotesView（recording mode 啟動）
 *
 * 下個 CP 處理：
 *  - RV2LayoutA: 投影片大 + 右下 transcript stream（取代 NotesView
 *    的 split panel）
 *  - RV2FloatingNotes：⌘⇧N 浮動 markdown 筆記窗
 *  - RV2FinishingOverlay：5-step transcribe / segment / summary /
 *    index / done 結束過場動畫
 *  - 拔掉本 banner 跟 NotesView host
 */

import NotesView from '../NotesView';
import s from './H18RecordingPage.module.css';

export interface H18RecordingPageProps {
    courseId: string;
    lectureId: string;
    onBack: () => void;
}

export default function H18RecordingPage({
    courseId,
    lectureId,
    onBack,
}: H18RecordingPageProps) {
    return (
        <div className={s.page}>
            <div className={s.banner}>
                <span className={s.bannerDot} aria-hidden />
                <span className={s.bannerLabel}>● REC · LIVE</span>
                <span className={s.bannerNote}>
                    錄音引擎沿用 legacy NotesView。完整 H18 RV2 layout
                    (投影片 + 浮動筆記 + 5-step finishing) 預計下個 CP。
                </span>
                <div className={s.bannerSpacer} />
                <button type="button" onClick={onBack} className={s.bannerBack}>
                    ← 返回課程
                </button>
            </div>
            <div className={s.host}>
                <NotesView
                    courseId={courseId}
                    lectureId={lectureId}
                    onBack={onBack}
                />
            </div>
        </div>
    );
}
