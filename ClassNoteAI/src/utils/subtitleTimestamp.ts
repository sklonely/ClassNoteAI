/**
 * subtitleTimestamp — Phase 7 Sprint 2 (S2.11)
 *
 * `subtitle.timestamp` 在 V12 schema 規格下統一為「自 lecture 起點起算的相對秒
 * (float)」。歷史資料可能以下列任一形式存在：
 *
 *   1. unix epoch ms (e.g. `Date.now()` — 1.7e12 等級)
 *   2. session-relative ms (大數但 < 1e10)
 *   3. session-relative seconds — 期望格式 (通常 < 1e6)
 *
 * 本檔案提供雙向轉換 + idempotent migration helper，搭配
 * `recordingSessionService.stop()` 的 step-3 (index) subtitle save 路徑使用，
 * 並讓未來 V12 schema migration (Sprint 3 / PLAN §8.2) 有現成 helper 可呼叫。
 *
 * 設計原則：
 *   - **idempotent** — 對已是 relative seconds 的 timestamp 再呼叫一次仍回相同值，
 *     讓 stop pipeline 重跑或 migration 重跑都不會把 60 秒疊成 6e10
 *   - **input-aware** — 用 1e9 (約 31 年的秒數) 當 cutoff 區分 ms 與 seconds
 *   - **clamp** — 若 absolute timestamp 早於 lectureStartedAtMs，視為 clock skew，
 *     回 0 而非負值
 */

/**
 * 把任何形式的 timestamp 換成相對 lecture 起點的秒數 (float)。
 *
 *   - input < 1e9 → 已是 relative seconds，原值返回（idempotent guard）
 *   - input >= 1e9 → 視為 absolute / unix ms，扣 lectureStartedAtMs 後 / 1000
 *
 * 1e9 cutoff 推導：~31.7 年的秒數。一堂課的相對秒不可能達到這個量級，
 * 而 unix ms 從 2001-09-09 起就 >= 1e12，這個門檻足以區分。
 */
export function toRelativeSeconds(
    timestamp: number,
    lectureStartedAtMs: number | null | undefined,
): number {
    if (!Number.isFinite(timestamp)) return 0;
    if (timestamp < 1_000_000_000) {
        // Already relative seconds; protect against negative input too.
        return Math.max(0, timestamp);
    }
    const start = lectureStartedAtMs ?? 0;
    return Math.max(0, (timestamp - start) / 1000);
}

/**
 * 反向：把 relative seconds 換回 absolute unix ms（給 UI 顯示 / 排序用）。
 */
export function fromRelativeSeconds(
    relSec: number,
    lectureStartedAtMs: number,
): number {
    if (!Number.isFinite(relSec)) return lectureStartedAtMs;
    return lectureStartedAtMs + relSec * 1000;
}

/**
 * 把 relative seconds 格式化成 MM:SS（給 transcript row / review timestamps 用）。
 *
 * 不做小時分割 — 一堂課很少超過 99 分鐘，且 transcript row 設計上預期
 * 兩位數分鐘佔位。如果未來需要 HH:MM:SS，請另開 formatLong 之類的 helper。
 */
export function formatRelativeTime(relSec: number): string {
    if (!Number.isFinite(relSec)) return '00:00';
    const total = Math.max(0, Math.floor(relSec));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Migrate 一筆 legacy subtitle row 的 timestamp 至 relative seconds。
 *
 * **Idempotent** — 若 input.timestamp 已是 < 1e9（已 migrate 過），原值返回。
 * 其他欄位透傳，不變。
 *
 * 用途：
 *   1. Sprint 3 V12 schema migration 一次性掃 DB 用
 *   2. 任何讀路徑想 defensively 處理舊資料時用 (e.g. global search index build)
 */
export function migrateSubtitleTimestamp<T extends { timestamp: number }>(
    sub: T,
    lectureStartedAtMs: number,
): T {
    return {
        ...sub,
        timestamp: toRelativeSeconds(sub.timestamp, lectureStartedAtMs),
    };
}
