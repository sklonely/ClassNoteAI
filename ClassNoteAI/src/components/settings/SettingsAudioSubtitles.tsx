import { useState } from "react";
import { Mic, Type, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { AppSettings } from "../../types";
import { AudioDevice } from "../../services/audioDeviceService";
import type { MicrophonePermissionState } from "../../services/mediaPermissionService";
import { Card } from "./shared";

interface Props {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  audioDevices: AudioDevice[];
  selectedDeviceId: string;
  setSelectedDeviceId: (id: string) => void;
  isLoadingDevices: boolean;
  onRefreshDevices: () => void;
  onRequestMicrophonePermission: () => void;
  hasMicrophonePermissionDetails: boolean;
  microphonePermissionState: MicrophonePermissionState;
}

export default function SettingsAudioSubtitles({
  settings,
  setSettings,
  audioDevices,
  selectedDeviceId,
  setSelectedDeviceId,
  isLoadingDevices,
  onRefreshDevices,
  onRequestMicrophonePermission,
  hasMicrophonePermissionDetails,
  microphonePermissionState,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Card
        title="音訊輸入"
        icon={<Mic className="w-5 h-5 text-red-500" />}
      >
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">麥克風設備</label>
              <div className="flex items-center gap-3">
                <button
                  onClick={onRequestMicrophonePermission}
                  disabled={isLoadingDevices}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                >
                  請求權限
                </button>
                <button
                  onClick={onRefreshDevices}
                  disabled={isLoadingDevices}
                  className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                >
                  <RefreshCw
                    size={14}
                    className={isLoadingDevices ? "animate-spin" : ""}
                  />
                  刷新
                </button>
              </div>
            </div>
            {!hasMicrophonePermissionDetails && (
              <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                目前尚未取得完整麥克風資訊。請先授權，否則裝置列表可能不完整。
              </p>
            )}
            {microphonePermissionState === "denied" && (
              <p className="mb-2 text-xs text-red-500">
                系統目前拒絕麥克風存取，錄音前需要先重新允許權限。
              </p>
            )}
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              disabled={isLoadingDevices}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
            >
              {audioDevices.length === 0 ? (
                <option value="">
                  {isLoadingDevices ? "加載中..." : "無可用設備"}
                </option>
              ) : (
                audioDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              採樣率：{settings.audio.sample_rate} Hz
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
                  audio: {
                    ...settings.audio,
                    sample_rate: parseInt(e.target.value),
                  },
                })
              }
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>8kHz</span>
              <span>48kHz</span>
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="字幕樣式"
        icon={<Type className="w-5 h-5 text-orange-500" />}
      >
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">
              字體大小：{settings.subtitle.font_size}px
            </label>
            <input
              type="range"
              min="12"
              max="32"
              value={settings.subtitle.font_size}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  subtitle: {
                    ...settings.subtitle,
                    font_size: parseInt(e.target.value),
                  },
                })
              }
              className="w-full accent-orange-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">顯示模式</label>
              <select
                value={settings.subtitle.display_mode}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    subtitle: {
                      ...settings.subtitle,
                      display_mode: e.target.value as "en" | "zh" | "both",
                    },
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
                    subtitle: {
                      ...settings.subtitle,
                      position: e.target.value as "top" | "bottom" | "floating",
                    },
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

          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            {advancedOpen ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
            進階樣式
          </button>

          {advancedOpen && (
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-200 dark:border-gray-700">
              <div>
                <label className="block text-sm font-medium mb-2">字體顏色</label>
                <input
                  type="color"
                  value={settings.subtitle.font_color}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      subtitle: {
                        ...settings.subtitle,
                        font_color: e.target.value,
                      },
                    })
                  }
                  className="w-full h-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  背景透明度：
                  {Math.round(settings.subtitle.background_opacity * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.subtitle.background_opacity}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      subtitle: {
                        ...settings.subtitle,
                        background_opacity: parseFloat(e.target.value),
                      },
                    })
                  }
                  className="w-full accent-orange-500"
                />
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
