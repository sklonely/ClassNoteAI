import { useEffect, useState } from "react";

import H18DeepApp from "./components/h18/H18DeepApp";
import LoginScreen from "./components/LoginScreen";
import ErrorBoundary from "./components/ErrorBoundary";
import SetupWizard from "./components/SetupWizard";
import RecoveryPromptModal from "./components/RecoveryPromptModal";
import ToastContainer from "./components/ToastContainer";
import ConfirmDialog from "./components/ConfirmDialog";
import AIChatWindow from "./components/AIChatWindow";
import type { RecoverableSession } from "./services/recordingRecoveryService";
import { storageService } from "./services/storageService";
import { authService } from "./services/authService";
import { setupService } from "./services/setupService";
import { toastService } from "./services/toastService";
import { confirmService } from "./services/confirmService";
import { buildInterruptedRecordingNotice } from "./services/recordingInterruptionNotice";
import { audioDeviceService } from "./services/audioDeviceService";
import { recordingSessionService } from "./services/recordingSessionService";
import type { RecordingSessionState } from "./services/recordingSessionService";
import { taskTrackerService } from "./services/taskTrackerService";
import { useAuth } from "./contexts/AuthContext";
import { getCurrentWindow } from "@tauri-apps/api/window";

type AppState = 'loading' | 'setup' | 'ready';

/**
 * S1.10 — App close-request handler dependencies.
 *
 * Lifted out of the useEffect into a dependency-injected pure function so
 * the close flow is unit-testable without spinning up the entire App tree
 * (login → setup → H18DeepApp → all the boot side-effects). Production
 * calls fill these in with the real singletons; tests pass mocks.
 */
export interface CloseRequestDeps {
    recordingSession: {
        getState: () => RecordingSessionState;
        mustFinalizeSync: () => Promise<boolean>;
    };
    confirm: {
        ask: (req: {
            title: string;
            message: string;
            confirmLabel?: string;
            cancelLabel?: string;
            variant?: 'default' | 'danger';
        }) => Promise<boolean>;
    };
    toast: {
        success: (message: string, detail?: string) => void;
        warning: (message: string, detail?: string) => void;
    };
    win: {
        close: () => Promise<void>;
    };
    /** Injected so tests don't actually wait the 600ms grace period. */
    sleep: (ms: number) => Promise<void>;
}

/**
 * V4 close flow (PHASE-7-PLAN §8.3).
 *
 *   - status idle/stopped/etc → 不 preventDefault, 直接放行
 *   - status recording/paused → confirm + preventDefault
 *       cancel → 不關
 *       OK → mustFinalizeSync → toast → window.close()
 *
 * The 600 ms `sleep` between toast and close gives the user a beat to
 * see the toast fire before the window disappears.
 *
 * TODO Sprint 2 S2.9: 把 SUMMARIZE_LECTURE / INDEX_LECTURE 任務寫進
 *   pending_actions 表，下次啟動 taskTrackerService 自動撈起來跑。目前
 *   mustFinalizeSync 只 drain 字幕跟存 lecture status='completed'，
 *   summary/index 不跑。
 */
export async function handleCloseRequest(
    event: { preventDefault: () => void },
    deps: CloseRequestDeps,
): Promise<void> {
    const state = deps.recordingSession.getState();
    const recording =
        state.status === 'recording' || state.status === 'paused';

    if (!recording) {
        // Idle / stopping / stopped — nothing to save, let Tauri close
        // the window normally.
        return;
    }

    // Active recording: stop the OS-level close, ask the user, and only
    // proceed (or not) based on their answer.
    event.preventDefault();

    const elapsedMin = Math.max(1, Math.round(state.elapsed / 60));
    const ok = await deps.confirm.ask({
        title: '正在錄音',
        message: `課堂錄音 (${elapsedMin} 分鐘) 仍在進行中。要結束並儲存嗎？`,
        confirmLabel: '結束並關閉',
        cancelLabel: '取消',
        variant: 'danger',
    });

    if (!ok) {
        // Already preventDefault'd — just bail.
        return;
    }

    // Best-effort drain. mustFinalizeSync swallows internal errors and
    // returns a single bool so we don't have to second-guess what
    // partially saved.
    const success = await deps.recordingSession.mustFinalizeSync();

    if (success) {
        deps.toast.success(
            '已儲存錄音',
            '摘要與索引將於下次開啟時於背景生成。',
        );
    } else {
        deps.toast.warning(
            '部分儲存失敗',
            '錄音已盡力保留，部分摘要 / 索引可能需手動重試。',
        );
    }

    // Let the toast paint before the window evaporates.
    await deps.sleep(600);
    await deps.win.close();
}

/**
 * cp75.27 P1-F — App boot recovery → hard-delete sweep ordering.
 *
 * Pre-cp75.27 the orphan-recovery scan (1.5s after appState=ready) and
 * the 30-day hard-delete sweep (5s after ready) ran on independent
 * `setTimeout`s. Race window: a lecture flagged for crash recovery at
 * 1.5s could ALSO match the `is_deleted = 1 AND deleted_at < cutoff`
 * predicate at 5s, get physically deleted before the user could click
 * "回復" in the recovery modal, then `finalize_recording` would crash
 * with "lecture row not found" when the user finally hit OK.
 *
 * Fix: chain the two phases in a single async sequence — recovery scan
 * runs first, hard-delete only fires once the scan completes (and only
 * if the caller is still mounted). The 5s mark is replaced with a
 * "scan done + small grace" delay; in practice that lands close to the
 * old 5s anyway because the scan itself is ~3.5s of IPC.
 *
 * DI'd so we can unit-test the ordering without spinning the full App
 * tree. The grace-period sleep is also injected (tests pass a
 * synchronous resolver) so the suite doesn't actually wait.
 */
export interface BootRecoverySweepDeps {
    /** Recovery scan + orphan cleanup. Must resolve before the sweep
     *  fires, even if it errors — we still want trash GC to happen. */
    runRecoveryScan: () => Promise<void>;
    /** Hard-delete rows older than `days` for `userId`. Returns the
     *  purged ids so the caller can toast. */
    hardDelete: (days: number, userId: string) => Promise<string[]>;
    /** Lookup the active user. */
    getUserId: () => string;
    /** Toast surface. Only `info` and `warning` paths are exercised. */
    toast: {
        info: (message: string, detail?: string) => void;
    };
    /** Injected for tests; production passes `(ms) => new Promise(...)`. */
    sleep: (ms: number) => Promise<void>;
    /** Cancellation guard — set to true in the effect cleanup so a fast
     *  unmount (e.g. test teardown, login change) doesn't fire the
     *  sweep against a torn-down App. */
    isCancelled: () => boolean;
    /** Grace period (ms) between scan completion and sweep. Defaults to
     *  3500 in production so the boot toast queue (migration notice,
     *  interrupted recording) lands first. */
    sweepGraceMs?: number;
}

export async function runBootRecoveryThenSweep(
    deps: BootRecoverySweepDeps,
): Promise<void> {
    // Phase 1: orphan-recovery scan. Errors are NOT fatal — we still
    // want the GC to fire so the user's trash doesn't grow unboundedly
    // just because the scan IPC happened to fail this boot.
    try {
        await deps.runRecoveryScan();
    } catch (err) {
        console.warn('[App] Crash-recovery scan failed (non-fatal):', err);
    }
    if (deps.isCancelled()) return;

    // Phase 2: small grace period so any toast / modal triggered by the
    // recovery scan paints before the GC toast lands on top of it.
    const grace = deps.sweepGraceMs ?? 3500;
    await deps.sleep(grace);
    if (deps.isCancelled()) return;

    // Phase 3: 30-day hard-delete sweep. cp75.6 — scoped to the active
    // user_id so user B's login doesn't get blamed for purging user A's
    // trash.
    try {
        const userId = deps.getUserId();
        const ids = await deps.hardDelete(30, userId);
        if (ids && ids.length > 0) {
            deps.toast.info(
                '已永久清除舊資料',
                `${ids.length} 個 30 天以上的垃圾桶項目已清除`,
            );
        }
    } catch (err) {
        console.warn('[App] hard_delete_trashed_older_than failed:', err);
    }
}

function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [recoverableSessions, setRecoverableSessions] = useState<RecoverableSession[]>([]);
  const { user } = useAuth();

  // Detached AI 助教 webview: spawned by openDetachedAiTutor with the
  // `?aiTutorWindow=1` query flag. That window shares this bundle
  // (Tauri serves the same `/` index.html) so we branch at the top of
  // App to render a minimal standalone shell instead of H18DeepApp.
  // Skips setup/login checks -- the main window already passed them
  // when the user clicked the AI 助教 button.
  const aiTutorWindow = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('aiTutorWindow') === '1';
  if (aiTutorWindow) {
    return (
      <ErrorBoundary>
        <AIChatWindow />
        <ToastContainer />
        <ConfirmDialog />
      </ErrorBoundary>
    );
  }

  // Check setup status on mount
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const isComplete = await setupService.isComplete();
        setAppState(isComplete ? 'ready' : 'setup');
      } catch (error) {
        console.error('Failed to check setup status:', error);
        // If check fails, assume setup is needed
        setAppState('setup');
      }
    };
    checkSetup();
  }, []);

  // Recover stale syllabus generations left over from a prior session.
  // Background LLM tasks are fire-and-forget (`void`), so if the app was
  // closed mid-flight the course stays stuck in `_classnote_status=generating`
  // and the UI shows a perpetual spinner. Flip those to `failed` with a
  // retry hint once, right after we know we're in a ready state.
  useEffect(() => {
    if (appState !== 'ready') return;
    storageService
      .recoverStaleGeneratingSyllabuses()
      .catch((err) => console.warn('[App] 課程大綱狀態回收失敗：', err));
  }, [appState]);

  // cp75.5 — load saved keyboard-shortcut overrides from the active
  // user's AppSettings into the keymapService singleton. The service's
  // internal `hydrate()` was previously never called, so customised
  // shortcuts saved through PKeyboard round-tripped to disk but never
  // applied at runtime — every restart silently reverted to defaults.
  // Re-runs on user change so a logout/login flow picks up the new
  // user's bindings.
  useEffect(() => {
    if (appState !== 'ready') return;
    void import('./services/keymapService')
      .then(({ keymapService }) => keymapService.hydrate())
      .catch((err) =>
        console.warn('[App] keymap hydrate failed:', err),
      );
  }, [appState, user]);

  // Background audio-link audit for completed lectures. This fixes the
  // "DB points at a stale absolute path from an older install/home dir"
  // class of bug even before the user re-opens the affected lecture.
  useEffect(() => {
    if (appState !== 'ready' || !user) return;
    const t = setTimeout(async () => {
      try {
        const [lectures, { auditCompletedLectureAudioLinks }] = await Promise.all([
          storageService.listLectures(),
          import('./services/audioPathService'),
        ]);
        const result = await auditCompletedLectureAudioLinks(lectures);
        if (result.recoveredLectureIds.length > 0) {
          console.log(
            `[App] Recovered broken audio links for ${result.recoveredLectureIds.length} lecture(s):`,
            result.recoveredLectureIds,
          );
        }
        if (result.unresolvedLectureIds.length > 0) {
          console.warn(
            '[App] Some lecture audio links are still broken after recovery:',
            result.unresolvedLectureIds,
          );
        }
      } catch (err) {
        console.warn('[App] Audio link audit failed (non-fatal):', err);
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [appState, user]);

  // 初始化主題
  useEffect(() => {
    const initTheme = async () => {
      try {
        const settings = await storageService.getAppSettings();
        if (settings?.theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      } catch (error) {
        console.error('Failed to load theme settings:', error);
      }
    };
    initTheme();
  }, []);

  // App-level 音訊裝置同步：啟動後先 enumerate，之後靠
  // focus / visibility / devicechange 自動刷新，避免設定頁成為
  // 唯一會修復 stale device 狀態的入口。
  useEffect(() => {
    if (appState !== 'ready' || !user) return;

    let cancelled = false;
    void audioDeviceService.initialize().catch((error) => {
      if (!cancelled) {
        console.warn('[App] Failed to initialize audio device service:', error);
      }
    });

    return () => {
      cancelled = true;
      audioDeviceService.destroy();
    };
  }, [appState, user]);

  // App-level Gemma sidecar 自動啟動。Provider=gemma 時錄音中要靠
  // llama-server 翻譯，但 H18 移植過程把舊 SettingsTranslation 的
  // 「啟動 sidecar」按鈕拿掉（PTranslate 沒接進去）→ 使用者沒地方按
  // → 字幕只有英文沒中文。改在啟動時自動 spawn：
  //  - 如果 model 不存在 → no-op（使用者去設定頁下載）
  //  - 如果 sidecar 已在跑 → idempotent (已 already_running)
  //  - 如果 spawn 失敗 → 安靜（toast 不打擾，只 console warn）
  // 真要 stop / restart 還是去 PTranslate 操作。
  useEffect(() => {
    if (appState !== 'ready' || !user) return;
    const t = setTimeout(async () => {
      try {
        const settings = await storageService.getAppSettings();
        const provider = settings?.translation?.provider || 'gemma';
        if (provider !== 'gemma') return;
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<{
          model_present: boolean;
          model_path: string;
          sidecar_running: boolean;
        }>('get_gemma_status').catch(() => null);
        if (!status?.model_present) {
          console.log('[App] Gemma model not downloaded — sidecar autostart skipped');
          return;
        }
        if (status.sidecar_running) return;
        const result = await invoke<string>('start_gemma_sidecar', {
          modelPath: status.model_path,
          port: null,
        }).catch((err) => `error:${err}`);
        console.log('[App] Gemma sidecar autostart:', result);
      } catch (err) {
        console.warn('[App] Gemma sidecar autostart failed (non-fatal):', err);
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [appState, user]);

  // v0.5.2 audit follow-up: surface migration notices to the user.
  // The DB init runs migrations eagerly (e.g. dropping stale embedding
  // vectors on model swaps). Previously those only hit stdout, so users
  // had no way to know their RAG index silently got wiped until they
  // noticed AI 助教 stopped returning relevant passages. Now we drain
  // the in-memory notice queue on app-ready and toast each one.
  useEffect(() => {
    if (appState !== 'ready') return;
    const t = setTimeout(async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const notices = await invoke<string[]>('consume_migration_notices');
        if (notices.length > 0) {
          const { toastService } = await import('./services/toastService');
          for (const msg of notices) {
            // `durationMs: 0` → sticky; these are important enough that
            // auto-dismiss would be the wrong default.
            toastService.show({ message: '資料庫遷移通知', detail: msg, type: 'warning', durationMs: 0 });
          }
        }
      } catch (err) {
        console.warn('[App] consume_migration_notices failed (non-fatal):', err);
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [appState]);

  // v0.5.2 + cp75.27: crash-recovery scan + 30-day hard-delete sweep,
  // CHAINED. If the app died mid-recording last session, there's a .pcm
  // file on disk and a DB row stuck at status='recording'. We populate
  // `recoverableSessions` state; `RecoveryPromptModal` renders a proper
  // React UI when there are sessions to resolve. Cleanup of
  // rows-without-pcm and pcm-without-rows happens silently.
  //
  // cp75.27 P1-F — the hard-delete sweep used to run on its own 5s
  // timer, racing the recovery scan. A lecture flagged for recovery at
  // 1.5s but ALSO 30+ days into its `is_deleted = 1` window would get
  // physically purged at 5s, leaving the recovery modal pointing at a
  // ghost row. We now chain: scan → small grace → sweep, in
  // `runBootRecoveryThenSweep`. The grace period replaces the old 5s
  // mark and lets any "interrupted recording" toast paint before the
  // GC toast lands on top.
  useEffect(() => {
    if (appState !== 'ready') return;
    let cancelled = false;

    const runRecoveryScan = async (): Promise<void> => {
      const { recordingRecoveryService } = await import('./services/recordingRecoveryService');
      const scan = await recordingRecoveryService.scan();

      if (scan.recoverable.length > 0) {
        setRecoverableSessions(scan.recoverable);
      }

      // Clean up any PCM orphans that have no lecture row — these are
      // dead weight and the user has nothing to recover to.
      for (const pcm of scan.pcmOrphansWithoutLecture) {
        try {
          await recordingRecoveryService.discardOrphanPcm(pcm.lectureId);
        } catch (err) {
          console.warn(`[App] Failed to clean orphan PCM ${pcm.lectureId}:`, err);
        }
      }

      // And clean up lecture rows whose audio was never written to
      // disk at all (pre-v0.5.2 sessions, or recordings that crashed
      // before the first 5s flush): flip them to 'completed' silently
      // rather than showing a "recover nothing" dialog.
      for (const lec of scan.lectureOrphansWithoutPcm) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('update_lecture_status', { id: lec.id, status: 'completed' });
          console.log(`[App] Flipped zombie lecture ${lec.id} to completed (no audio on disk)`);
        } catch (err) {
          console.warn(`[App] Failed to reconcile zombie lecture ${lec.id}:`, err);
        }
      }

      const interruptedNotice = buildInterruptedRecordingNotice(scan.lectureOrphansWithoutPcm);
      if (interruptedNotice) {
        toastService.show({
          ...interruptedNotice,
          type: 'warning',
          durationMs: 0,
        });
      }
    };

    // Initial 1.5s delay (legacy first-paint courtesy) before the
    // chain kicks off. After that, runBootRecoveryThenSweep runs the
    // scan, sleeps the grace period, then fires the 30-day GC.
    const t = setTimeout(() => {
      void runBootRecoveryThenSweep({
        runRecoveryScan,
        hardDelete: async (days, userId) => {
          const { invoke } = await import('@tauri-apps/api/core');
          return invoke<string[]>('hard_delete_trashed_older_than', {
            days,
            userId,
          });
        },
        getUserId: () =>
          authService.getUser()?.username || 'default_user',
        toast: { info: toastService.info.bind(toastService) },
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        isCancelled: () => cancelled,
      });
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [appState]);

  // S2.9 — restore persisted LLM tasks (summarize / index) from localStorage
  // on launch. If the previous session was killed mid-flight, this puts a
  // 'queued' row back in the tracker tray and fires a single info toast so
  // the user knows the work wasn't lost. Delayed 2s so other boot effects
  // (theme, audio device init, recovery scan) get to run first and the
  // restore toast doesn't pile on top of the migration / interruption ones.
  useEffect(() => {
    if (appState !== 'ready') return;
    const t = setTimeout(() => {
      void taskTrackerService.restoreFromPersistence();
    }, 2000);
    return () => clearTimeout(t);
  }, [appState]);

  // 啟動時靜默檢查更新
  useEffect(() => {
    const checkForUpdates = async () => {
      if (appState !== 'ready') return;

      try {
        // 動態導入避免阻塞啟動
        const { updateService } = await import('./services/updateService');
        const result = await updateService.checkForUpdates();

        if (result.available) {
          console.log(`[App] 發現新版本: ${result.version}`);
          // TODO: 可以在這裡顯示更新通知 Toast
        }
      } catch (error) {
        // 靜默失敗，不影響應用使用
        console.warn('[App] 檢查更新失敗:', error);
      }
    };

    // 延遲檢查，確保應用已完全載入
    const timer = setTimeout(checkForUpdates, 3000);
    return () => clearTimeout(timer);

  }, [appState]);

  // S1.10 — Tauri close-request flow (V4). 錄音中按 ✕ 不能直接關，
  // 否則使用者會丟掉 in-flight 字幕跟還沒 commit 的 lecture row。掛
  // onCloseRequested 一個 listener，狀態是 recording / paused 才彈
  // confirm；其餘狀態保持 OS 預設（直接關）。確認後跑 mustFinalizeSync
  // 把字幕跟 lecture row drain 進 DB，再手動 win.close()。
  //
  // 等 appState 'ready' + user 是因為 setup / login 階段沒人有錄音，
  // 也避免 setup 流程被 confirm dialog 卡住。
  useEffect(() => {
    if (appState !== 'ready' || !user) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const win = getCurrentWindow();
        unlisten = await win.onCloseRequested((event) =>
          handleCloseRequest(event, {
            recordingSession: {
              getState: () => recordingSessionService.getState(),
              mustFinalizeSync: () =>
                recordingSessionService.mustFinalizeSync(),
            },
            confirm: {
              ask: (req) => confirmService.ask(req),
            },
            toast: {
              success: (message, detail) => toastService.success(message, detail),
              warning: (message, detail) => toastService.warning(message, detail),
            },
            win: {
              close: () => win.close(),
            },
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          }),
        );
        // If we already unmounted while awaiting, drop the listener now.
        if (cancelled) {
          unlisten?.();
          unlisten = null;
        }
      } catch (err) {
        console.warn('[App] onCloseRequested wire-up failed (non-fatal):', err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [appState, user]);

  const handleSetupComplete = () => {
    setAppState('ready');
  };

  // Show loading screen while checking setup
  if (appState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-white text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p>正在檢查環境...</p>
        </div>
      </div>
    );
  }

  // Show setup wizard if setup is not complete
  if (appState === 'setup') {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  // Show login screen if user not logged in
  if (!user) {
    return <LoginScreen onComplete={() => setAppState('ready')} />;
  }

  return (
    <ErrorBoundary>
      <H18DeepApp />
      <RecoveryPromptModal
        sessions={recoverableSessions}
        onSessionResolved={(id) =>
          setRecoverableSessions((prev) => prev.filter((s) => s.lectureId !== id))
        }
        onAllResolved={() => setRecoverableSessions([])}
      />
      <ToastContainer />
      <ConfirmDialog />
    </ErrorBoundary>
  );
}

export default App;
