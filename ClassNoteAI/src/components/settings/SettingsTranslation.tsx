import { Languages, HardDrive, Cloud } from "lucide-react";
import { AppSettings } from "../../types";
import TranslationModelManager from "../TranslationModelManager";
import { Card, SegmentedControl } from "./shared";

interface Props {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
}

type SourceLang = NonNullable<AppSettings["translation"]>["source_language"];

export default function SettingsTranslation({ settings, setSettings }: Props) {
  const provider = settings.translation?.provider || "local";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Card
        title="翻譯服務"
        icon={<Languages className="w-5 h-5 text-green-500" />}
        subtitle="課堂語音 → 目標語言，供字幕與摘要使用。"
      >
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">翻譯引擎</label>
            <SegmentedControl
              value={provider}
              options={[
                {
                  value: "local",
                  label: "本地 ONNX",
                  icon: <HardDrive size={16} />,
                  hint: "離線、免費",
                },
                {
                  value: "google",
                  label: "Google Cloud",
                  icon: <Cloud size={16} />,
                  hint: "線上、需 API 金鑰",
                },
              ]}
              onChange={(v) =>
                setSettings({
                  ...settings,
                  translation: {
                    ...settings.translation,
                    provider: v as "local" | "google",
                  },
                })
              }
            />
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
            {provider === "local" ? (
              <TranslationModelManager />
            ) : (
              <div>
                <label className="block text-sm font-medium mb-2">
                  Google Cloud Translation API 金鑰（可選）
                </label>
                <input
                  type="password"
                  value={settings.translation?.google_api_key || ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      translation: {
                        ...settings.translation,
                        google_api_key: e.target.value,
                      },
                    })
                  }
                  placeholder="留空使用非官方接口，或輸入 API 金鑰"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  走官方 API 需要 Google Cloud 專案啟用 Translation API。
                  留空則使用免費非官方端點（用量大時會被擋）。
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div>
              <label className="block text-sm font-medium mb-2">
                講者語言（來源）
              </label>
              <select
                value={settings.translation?.source_language || "auto"}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    translation: {
                      ...settings.translation,
                      source_language: e.target.value as SourceLang,
                    },
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="auto">自動偵測</option>
                <option value="en">English</option>
                <option value="ja">日本語 (Japanese)</option>
                <option value="ko">한국어 (Korean)</option>
                <option value="fr">Français (French)</option>
                <option value="de">Deutsch (German)</option>
                <option value="es">Español (Spanish)</option>
                <option value="zh-TW">繁體中文</option>
                <option value="zh-CN">簡體中文</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                講者使用的語言，影響 ASR 與翻譯方向。
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">目標語言</label>
              <select
                value={settings.translation?.target_language || "zh-TW"}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    translation: {
                      ...settings.translation,
                      target_language: e.target.value,
                    },
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="zh-TW">繁體中文</option>
                <option value="zh-CN">簡體中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                字幕、摘要、Q&A 都翻譯成這個語言。
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
