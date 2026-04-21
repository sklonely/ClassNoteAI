import { useEffect, useState } from "react";
import {
  Info,
  RefreshCw,
  Download,
  CheckCircle,
  Cpu,
  RotateCcw,
  FlaskConical,
} from "lucide-react";
import { Card } from "./shared";
import { setupService } from "../../services/setupService";
import { toastService } from "../../services/toastService";
import { confirmService } from "../../services/confirmService";
import type { ReleaseChannel } from "../../services/updateService";

interface Props {
  appVersion: string;
}

export default function SettingsAboutUpdates({ appVersion }: Props) {
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    available: boolean;
    version?: string;
  } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [channel, setChannel] = useState<ReleaseChannel>("stable");

  // Load the user's current channel selection on mount. Default to
  // stable on any failure — see getReleaseChannel() for the same
  // defensive stance on the service side.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { updateService } = await import("../../services/updateService");
        const current = await updateService.getReleaseChannel();
        if (!cancelled) setChannel(current);
      } catch (e) {
        console.warn("[SettingsAboutUpdates] Failed to read release channel:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChannelChange = async (next: ReleaseChannel) => {
    const prev = channel;
    setChannel(next);
    // Clear any prior check result — the new channel might see a
    // different "available" answer, and showing the stale one is
    // misleading.
    setUpdateInfo(null);
    setUpdateError(null);
    try {
      const { updateService } = await import("../../services/updateService");
      await updateService.setReleaseChannel(next);
    } catch (e) {
      console.error("[SettingsAboutUpdates] Failed to save channel:", e);
      setChannel(prev);
      toastService.error(
        "無法儲存更新通道設定",
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateError(null);
    try {
      const { updateService } = await import("../../services/updateService");
      const result = await updateService.checkForUpdates();
      setUpdateInfo(result);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "檢查更新失敗");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setIsDownloading(true);
    setUpdateError(null);
    try {
      const { updateService } = await import("../../services/updateService");
      await updateService.downloadAndInstall((progress) => {
        setDownloadProgress(progress.percentage);
      });
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "下載更新失敗");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleManualDownload = async () => {
    if (!updateInfo?.version) return;
    setIsDownloading(true);
    setUpdateError(null);
    try {
      const { updateService } = await import("../../services/updateService");
      await updateService.downloadAndOpenDmg(updateInfo.version, (percentage) => {
        setDownloadProgress(percentage);
      });
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "手動下載失敗");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenDevTools = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_devtools");
    } catch (e) {
      console.error("Failed to open devtools:", e);
    }
  };

  const [isResettingSetup, setIsResettingSetup] = useState(false);
  const handleResetSetup = async () => {
    // Use the themed ConfirmDialog (confirmService) instead of the
    // native window.confirm/alert combo: native dialogs clash with
    // the app's dark/purple design and users reported the old flow
    // looking like OS chrome dropped in mid-page. The success path
    // is a single toast + short delay before reload -- no more
    // stacked modal + alert + migration-notice toast pile-up.
    const ok = await confirmService.ask({
      title: '重置 Setup Wizard？',
      message:
        '下次啟動時會重新顯示新手引導（語言選擇、AI 配置、模型下載檢查）。\n\n' +
        '你的課堂、筆記、設定不會被刪除，只是 setup_complete.json 標記會被清掉。',
      confirmLabel: '重置',
      variant: 'danger',
    });
    if (!ok) return;
    setIsResettingSetup(true);
    try {
      await setupService.resetStatus();
      toastService.success('Setup wizard 已重置', '重新載入中…');
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toastService.error('重置失敗', e instanceof Error ? e.message : String(e));
      setIsResettingSetup(false);
    }
  };

  const isWindows = typeof navigator !== "undefined" &&
    navigator.userAgent.includes("Windows");

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Card
        title="關於 ClassNote AI"
        icon={<Info className="w-5 h-5 text-blue-500" />}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-600 dark:text-gray-400">版本</span>
            <span className="font-mono">{appVersion}</span>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <label
                  htmlFor="release-channel"
                  className="text-sm text-gray-700 dark:text-gray-300"
                >
                  更新通道
                </label>
              </div>
              <select
                id="release-channel"
                value={channel}
                onChange={(e) => handleChannelChange(e.target.value as ReleaseChannel)}
                disabled={isCheckingUpdate || isDownloading}
                className="text-sm px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
              >
                <option value="stable">穩定版 (Stable)</option>
                <option value="beta">Beta (公開測試版)</option>
                <option value="alpha">Alpha (開發測試版)</option>
              </select>
            </div>
            {channel !== "stable" && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {channel === "alpha"
                  ? "Alpha 版本可能包含未穩定功能，安裝時會開啟安裝程式請你手動完成。"
                  : "Beta 版本功能接近正式版但仍在測試中，安裝時會開啟安裝程式請你手動完成。"}
              </p>
            )}
          </div>

          <div>
            <button
              onClick={handleCheckUpdate}
              disabled={isCheckingUpdate || isDownloading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
            >
              {isCheckingUpdate ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  正在檢查...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  檢查更新
                </>
              )}
            </button>
          </div>

          {updateInfo && (
            <div
              className={`p-4 rounded-lg ${
                updateInfo.available
                  ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                  : "bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700"
              }`}
            >
              {updateInfo.available ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-medium">
                      發現新版本：{updateInfo.version}
                    </span>
                  </div>
                  <button
                    onClick={handleDownloadUpdate}
                    disabled={isDownloading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                  >
                    {isDownloading ? (
                      <>
                        <Download className="w-4 h-4 animate-bounce" />
                        下載中 {downloadProgress}%
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        下載並安裝
                      </>
                    )}
                  </button>

                  {!isWindows && channel === "stable" && (
                    <>
                      <div className="relative flex py-1 items-center">
                        <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
                        <span className="flex-shrink-0 mx-2 text-xs text-gray-400">或</span>
                        <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
                      </div>
                      <button
                        onClick={handleManualDownload}
                        disabled={isDownloading}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 text-green-600 dark:text-green-400 border border-green-600 dark:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-400 disabled:border-gray-300 dark:disabled:border-gray-700 rounded-lg transition-colors"
                      >
                        {isDownloading ? (
                          <>下載中 {downloadProgress}%</>
                        ) : (
                          <>
                            <Download className="w-4 h-4" />
                            下載 .dmg 並開啟（手動安裝）
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <CheckCircle className="w-5 h-5" />
                  <span>已是最新版本</span>
                </div>
              )}
            </div>
          )}

          {updateError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
              {updateError}
            </div>
          )}
        </div>
      </Card>

      <Card
        title="開發者選項"
        icon={<Cpu className="w-5 h-5 text-orange-500" />}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            開發者工具（DevTools）用於調試前端與診斷問題。
          </p>
          <button
            onClick={handleOpenDevTools}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
          >
            <Cpu className="w-4 h-4" />
            開啟開發者工具（DevTools）
          </button>

          {/* v0.5.2: re-run Setup Wizard. Calls setupService.resetStatus
              (which removes `setup_complete.json`) then reloads. User
              data is untouched — only the first-run marker gets cleared. */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              重置新手引導，用於測試或確認最新的 wizard 流程。
              只會清掉 setup 完成標記，不會刪你的課堂、筆記、設定。
            </p>
            <button
              onClick={handleResetSetup}
              disabled={isResettingSetup}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white dark:bg-slate-800 border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {isResettingSetup ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  重置中...
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" />
                  重置 Setup Wizard（保留資料）
                </>
              )}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
