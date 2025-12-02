import { useState } from "react";
import { Save } from "lucide-react";
import { AppSettings } from "../types";

export default function SettingsView() {
  const [settings, setSettings] = useState<AppSettings>({
    server: {
      url: "http://localhost",
      port: 8080,
      enabled: false,
    },
    audio: {
      sample_rate: 16000,
      chunk_duration: 2,
    },
    subtitle: {
      font_size: 18,
      font_color: "#FFFFFF",
      background_opacity: 0.8,
      position: "bottom",
      display_mode: "both",
    },
    theme: "light",
  });

  const handleSave = () => {
    // TODO: 實現保存設置邏輯
    console.log("保存設置", settings);
  };

  return (
    <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">設置</h1>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Save size={18} />
            保存設置
          </button>
        </div>

        {/* 服務器設置 */}
        <div className="mb-6 bg-white dark:bg-slate-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">服務器設置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">服務器 URL</label>
              <input
                type="text"
                value={settings.server.url}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    server: { ...settings.server, url: e.target.value },
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">端口</label>
              <input
                type="number"
                value={settings.server.port}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    server: { ...settings.server, port: parseInt(e.target.value) },
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.server.enabled}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    server: { ...settings.server, enabled: e.target.checked },
                  })
                }
                className="w-4 h-4"
              />
              <label>啟用遠程服務器</label>
            </div>
          </div>
        </div>

        {/* 音頻設置 */}
        <div className="mb-6 bg-white dark:bg-slate-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">音頻設置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">麥克風設備</label>
              <select className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800">
                <option>默認設備</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                採樣率: {settings.audio.sample_rate} Hz
              </label>
              <input
                type="range"
                min="8000"
                max="48000"
                step="8000"
                value={settings.audio.sample_rate}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    audio: { ...settings.audio, sample_rate: parseInt(e.target.value) },
                  })
                }
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* 字幕設置 */}
        <div className="mb-6 bg-white dark:bg-slate-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">字幕設置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                字體大小: {settings.subtitle.font_size}px
              </label>
              <input
                type="range"
                min="12"
                max="24"
                value={settings.subtitle.font_size}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    subtitle: { ...settings.subtitle, font_size: parseInt(e.target.value) },
                  })
                }
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">顯示模式</label>
              <select
                value={settings.subtitle.display_mode}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    subtitle: { ...settings.subtitle, display_mode: e.target.value as any },
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              >
                <option value="en">僅英文</option>
                <option value="zh">僅中文</option>
                <option value="both">中英對照</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">字幕位置</label>
              <select
                value={settings.subtitle.position}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    subtitle: { ...settings.subtitle, position: e.target.value as any },
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              >
                <option value="bottom">底部</option>
                <option value="top">頂部</option>
                <option value="floating">浮動</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

