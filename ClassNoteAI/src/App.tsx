import { useEffect, useState } from "react";

import MainWindow from "./components/MainWindow";
import LoginScreen from "./components/LoginScreen";
import ErrorBoundary from "./components/ErrorBoundary";
import SetupWizard from "./components/SetupWizard";
import { storageService } from "./services/storageService";
import { setupService } from "./services/setupService";
import { syncService } from "./services/syncService";
import { useAuth } from "./contexts/AuthContext";

type AppState = 'loading' | 'setup' | 'ready';

function App() {
  const [appState, setAppState] = useState<AppState>('loading');
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
    </ErrorBoundary>
  );
}

export default App;
