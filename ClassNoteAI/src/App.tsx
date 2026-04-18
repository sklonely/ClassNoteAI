import { useEffect, useState } from "react";

import MainWindow from "./components/MainWindow";
import LoginScreen from "./components/LoginScreen";
import ErrorBoundary from "./components/ErrorBoundary";
import SetupWizard from "./components/SetupWizard";
import RecoveryPromptModal from "./components/RecoveryPromptModal";
import ToastContainer from "./components/ToastContainer";
import type { RecoverableSession } from "./services/recordingRecoveryService";
import { storageService } from "./services/storageService";
import { setupService } from "./services/setupService";
import { syncService } from "./services/syncService";
import { useAuth } from "./contexts/AuthContext";

type AppState = 'loading' | 'setup' | 'ready';

function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [recoverableSessions, setRecoverableSessions] = useState<RecoverableSession[]>([]);
  const { user } = useAuth();

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

  // v0.5.2: crash-recovery scan on launch. If the app died mid-
  // recording last session, there's a .pcm file on disk and a DB row
  // stuck at status='recording'. We populate `recoverableSessions`
  // state; `RecoveryPromptModal` renders a proper React UI when there
  // are sessions to resolve. Cleanup of rows-without-pcm and pcm-
  // without-rows happens silently.
  useEffect(() => {
    const checkRecordingRecovery = async () => {
      if (appState !== 'ready') return;
      try {
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
      } catch (err) {
        console.warn('[App] Crash-recovery scan failed (non-fatal):', err);
      }
    };
    // Fire after initial render settles so we don't block first paint.
    const t = setTimeout(checkRecordingRecovery, 1500);
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

  // 啟動時自動同步
  useEffect(() => {
    const autoSync = async () => {
      if (appState !== 'ready') return;

      try {
        const settings = await storageService.getAppSettings();
        if (settings?.sync?.autoSync && settings.sync.username && settings.server?.url) {
          console.log('[App] 觸發啟動自動同步...');
          // 確保 server url 正確
          const serverUrl = settings.server.url;
          await syncService.sync(serverUrl, settings.sync.username);
          console.log('[App] 啟動自動同步完成');

          // 更新上次同步時間
          const now = new Date().toISOString();
          await storageService.saveAppSettings({
            ...settings,
            sync: {
              ...settings.sync,
              lastSyncTime: now
            }
          });
        }
      } catch (error) {
        console.error('[App] 啟動自動同步失敗:', error);
      }
    };

    // 延遲 5 秒執行，避免與啟動重資源競爭
    const timer = setTimeout(autoSync, 5000);
    return () => clearTimeout(timer);
  }, [appState]);

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
      <MainWindow />
      <RecoveryPromptModal
        sessions={recoverableSessions}
        onSessionResolved={(id) =>
          setRecoverableSessions((prev) => prev.filter((s) => s.lectureId !== id))
        }
        onAllResolved={() => setRecoverableSessions([])}
      />
      <ToastContainer />
    </ErrorBoundary>
  );
}

export default App;
