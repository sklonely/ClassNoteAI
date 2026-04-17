/**
 * Modal shown before the user triggers an unofficial-channel sign-in
 * (currently used for ChatGPT OAuth via the Codex client_id).
 *
 * State is stored per-provider so we only show it on first use; user can
 * re-enable it from settings if they change their mind later.
 */

import { AlertTriangle } from 'lucide-react';

export interface UnofficialChannelWarningProps {
  providerName: string;
  onContinue: () => void;
  onCancel: () => void;
}

export default function UnofficialChannelWarning({
  providerName,
  onContinue,
  onCancel,
}: UnofficialChannelWarningProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold">非官方接入通道</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              ClassNoteAI is about to authenticate with {providerName}.
            </p>
          </div>
        </div>

        <div className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
          <p>
            此路徑透過 OpenAI 為 Codex CLI 公開的 OAuth client_id 來重用你的
            ChatGPT 訂閱配額，<strong>並非 OpenAI 官方為第三方應用提供的
            API 通道</strong>。
          </p>
          <p className="text-xs">
            可能風險：OpenAI 若調整 Codex 的內部端點或輪替 client_id，此路徑
            會突然失效。若需長期穩定，請改用 GitHub Models（Copilot Pro 訂閱）或
            OpenAI Platform API key。
          </p>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            我了解，繼續登入
          </button>
        </div>
      </div>
    </div>
  );
}
