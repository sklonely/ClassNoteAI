import { useState } from "react";
import {
  Info,
  RefreshCw,
  Download,
  CheckCircle,
  Cpu,
} from "lucide-react";
import { Card } from "./shared";

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

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
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

                  {!isWindows && (
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
        </div>
      </Card>
    </div>
  );
}
