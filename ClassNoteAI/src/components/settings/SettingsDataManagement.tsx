import { useState } from "react";
import {
  Database,
  Download,
  Upload,
  AlertCircle,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { storageService } from "../../services/storageService";
import { Card } from "./shared";

export default function SettingsDataManagement() {
  const [importStatus, setImportStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const handleExport = async () => {
    try {
      await storageService.exportDataToFile();
      setImportStatus({ success: true, message: "數據導出成功" });
      setTimeout(() => setImportStatus(null), 3000);
    } catch (error) {
      setImportStatus({
        success: false,
        message: `導出失敗：${error instanceof Error ? error.message : String(error)}`,
      });
      setTimeout(() => setImportStatus(null), 5000);
    }
  };

  const handleImport = async () => {
    if (!confirm("導入數據將覆蓋現有數據，是否繼續？")) return;
    try {
      const result = await storageService.importDataFromFile();
      setImportStatus({
        success: true,
        message: `成功導入 ${result.imported} 個課程${result.errors.length > 0 ? `，${result.errors.length} 個錯誤` : ""}`,
      });
      setTimeout(() => setImportStatus(null), 5000);
    } catch (error) {
      setImportStatus({
        success: false,
        message: `導入失敗：${error instanceof Error ? error.message : String(error)}`,
      });
      setTimeout(() => setImportStatus(null), 5000);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Card
        title="備份與恢復"
        icon={<Database className="w-5 h-5 text-teal-500" />}
      >
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
              <h4 className="font-medium mb-2">導出數據</h4>
              <p className="text-xs text-gray-500 mb-4">
                將所有課程、字幕、筆記和設置導出為 JSON 檔案。
              </p>
              <button
                onClick={handleExport}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <Download size={16} />
                導出備份
              </button>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
              <h4 className="font-medium mb-2">導入數據</h4>
              <p className="text-xs text-gray-500 mb-4">
                從 JSON 檔案恢復數據。注意：這將覆蓋現有數據。
              </p>
              <button
                onClick={handleImport}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <Upload size={16} />
                導入備份
              </button>
            </div>
          </div>

          {importStatus && (
            <div
              className={`flex items-center gap-2 p-3 rounded-lg ${
                importStatus.success
                  ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                  : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
              }`}
            >
              <AlertCircle size={18} />
              <span className="text-sm">{importStatus.message}</span>
            </div>
          )}
        </div>
      </Card>

      <Card
        title="回收桶"
        icon={<Trash2 className="w-5 h-5 text-red-500" />}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            查看已刪除的項目，可還原或永久刪除。
          </p>
          <button
            onClick={() => (window as any).__setShowTrashView?.(true)}
            className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-medium transition dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 flex items-center gap-1"
          >
            開啟
            <ChevronRight size={14} />
          </button>
        </div>
      </Card>
    </div>
  );
}
