import { useState, useEffect, useRef } from "react";
import {
  Save,
  CheckCircle,
  Mic,
  Languages,
  Brain,
  Volume2,
  Database,
  Info,
  ChevronRight,
  Monitor,
} from "lucide-react";
import { AppSettings } from "../types";
import { getVersion } from "@tauri-apps/api/app";

import { storageService } from "../services/storageService";
import {
  audioDeviceService,
  AudioDevice,
} from "../services/audioDeviceService";
import type { MicrophonePermissionState } from "../services/mediaPermissionService";
import { toastService } from "../services/toastService";

import SettingsLocalTranscription from "./settings/SettingsLocalTranscription";
import SettingsTranslation from "./settings/SettingsTranslation";
import SettingsCloudAI from "./settings/SettingsCloudAI";
import SettingsAudioSubtitles from "./settings/SettingsAudioSubtitles";
import SettingsDataManagement from "./settings/SettingsDataManagement";
import SettingsAboutUpdates from "./settings/SettingsAboutUpdates";
import SettingsInterface from "./settings/SettingsInterface";

type TabId =
  | "local-transcription"
  | "translation"
  | "cloud-ai"
  | "interface"
  | "audio-subtitles"
  | "data-management"
  | "about-updates";

const DEFAULT_SETTINGS: AppSettings = {
  server: { url: "http://localhost", port: 8080, enabled: false },
  audio: { sample_rate: 16000, chunk_duration: 2 },
  recording: {},
  subtitle: {
    font_size: 18,
    font_color: "#FFFFFF",
    background_opacity: 0.8,
    position: "bottom",
    display_mode: "both",
  },
  theme: "light",
};

interface Props {
  onClose?: () => void;
}

interface NavItem {
  id: TabId;
  label: string;
  icon: typeof Brain;
  description: string;
}

const PRIMARY_NAV: NavItem[] = [
  {
    id: "local-transcription",
    label: "本地轉錄模型",
    icon: Mic,
    description: "離線 Whisper 語音辨識",
  },
  {
    id: "translation",
    label: "翻譯服務",
    icon: Languages,
    description: "本地或 Google — 二選一",
  },
  {
    id: "cloud-ai",
    label: "雲端 AI 助理",
    icon: Brain,
    description: "摘要、Q&A、關鍵字",
  },
];

const SECONDARY_NAV: NavItem[] = [
  {
    id: "interface",
    label: "介面與顯示",
    icon: Monitor,
    description: "視窗、面板與佈局",
  },
  {
    id: "audio-subtitles",
    label: "音訊與字幕",
    icon: Volume2,
    description: "麥克風與字幕樣式",
  },
  {
    id: "data-management",
    label: "資料管理",
    icon: Database,
    description: "備份、恢復與回收桶",
  },
  {
    id: "about-updates",
    label: "關於與更新",
    icon: Info,
    description: "版本與開發者選項",
  },
];

const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

export default function SettingsView({}: Props) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<TabId>("local-transcription");
  const [saveStatus, setSaveStatus] =
    useState<"idle" | "saving" | "success" | "error">("idle");
  const [appVersion, setAppVersion] = useState<string>("...");

  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [hasMicrophonePermissionDetails, setHasMicrophonePermissionDetails] =
    useState(false);
  const [microphonePermissionState, setMicrophonePermissionState] =
    useState<MicrophonePermissionState>("unknown");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  useEffect(() => {
    let mounted = true;
    const cleanup = audioDeviceService.subscribe((snapshot) => {
      if (!mounted) return;
      setAudioDevices(snapshot.devices);
      setSelectedDeviceId(
        snapshot.preferredDeviceId || snapshot.defaultDeviceId || "",
      );
      setHasMicrophonePermissionDetails(snapshot.hasPermissionDetails);
      setMicrophonePermissionState(snapshot.permissionState);
    });

    setIsLoadingDevices(true);
    void audioDeviceService
      .initialize()
      .catch((error) => {
        if (mounted) {
          console.error("加載音頻設備失敗:", error);
          setAudioDevices([]);
        }
      })
      .finally(() => {
        if (mounted) setIsLoadingDevices(false);
      });

    return () => {
      mounted = false;
      cleanup();
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const saved = await storageService.getAppSettings();
        if (saved) {
          setSettings({
            server: {
              url: saved.server?.url ?? DEFAULT_SETTINGS.server.url,
              port: saved.server?.port ?? DEFAULT_SETTINGS.server.port,
              enabled: saved.server?.enabled ?? false,
            },
            audio: {
              device_id: saved.audio?.device_id,
              sample_rate:
                saved.audio?.sample_rate ?? DEFAULT_SETTINGS.audio.sample_rate,
              chunk_duration:
                saved.audio?.chunk_duration ??
                DEFAULT_SETTINGS.audio.chunk_duration,
            },
            subtitle: {
              font_size:
                saved.subtitle?.font_size ?? DEFAULT_SETTINGS.subtitle.font_size,
              font_color:
                saved.subtitle?.font_color ??
                DEFAULT_SETTINGS.subtitle.font_color,
              background_opacity:
                saved.subtitle?.background_opacity ??
                DEFAULT_SETTINGS.subtitle.background_opacity,
              position:
                saved.subtitle?.position ?? DEFAULT_SETTINGS.subtitle.position,
              display_mode:
                saved.subtitle?.display_mode ??
                DEFAULT_SETTINGS.subtitle.display_mode,
            },
            theme: saved.theme ?? "light",
            models: saved.models,
            recording: saved.recording,
            translation: saved.translation,
          });
        }
      } catch (error) {
        console.error("加載設置失敗:", error);
      }
    })();
  }, []);

  const handleRefreshDevices = async () => {
    setIsLoadingDevices(true);
    try {
      await audioDeviceService.getAudioInputDevices();
    } catch (error) {
      console.error("刷新設備列表失敗:", error);
      toastService.error("刷新設備列表失敗", error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingDevices(false);
    }
  };

  const handleRequestMicrophonePermission = async () => {
    setIsLoadingDevices(true);
    try {
      await audioDeviceService.requestMicrophonePermission();
      toastService.success("麥克風權限已更新");
    } catch (error) {
      console.error("請求麥克風權限失敗:", error);
      toastService.error(
        "無法取得麥克風權限",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsLoadingDevices(false);
    }
  };

  const handleDeviceSelectionChange = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    try {
      await audioDeviceService.setPreferredDevice(deviceId || undefined);
    } catch (error) {
      console.error("保存音訊裝置選擇失敗:", error);
      toastService.error(
        "保存音訊裝置失敗",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleSave = async () => {
    setSaveStatus("saving");
    try {
      const next: AppSettings = {
        ...settings,
        audio: {
          ...settings.audio,
          device_id: selectedDeviceId || undefined,
        },
      };
      await storageService.saveAppSettings(next);
      document.documentElement.classList.toggle("dark", next.theme === "dark");

      setSaveStatus("success");
      window.dispatchEvent(new CustomEvent("classnote-settings-changed"));
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (error) {
      console.error("保存設置失敗:", error);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  // Auto-save whenever settings or device selection change. The
  // initial-load useEffect above populates state from storage, so we
  // guard with `didHydrate` to avoid an immediate round-trip
  // re-save on first mount. 300ms debounce collapses rapid edits
  // (e.g. dragging a slider) into a single write.
  const didHydrate = useRef(false);
  useEffect(() => {
    if (!didHydrate.current) {
      // Mark hydrated once the first storage-load populates state.
      if (settings !== DEFAULT_SETTINGS) didHydrate.current = true;
      return;
    }
    const t = setTimeout(() => { handleSave(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, selectedDeviceId]);

  const current = ALL_NAV.find((i) => i.id === activeTab);

  const renderContent = () => {
    switch (activeTab) {
      case "local-transcription":
        return <SettingsLocalTranscription />;
      case "translation":
        return (
          <SettingsTranslation settings={settings} setSettings={setSettings} />
        );
      case "cloud-ai":
        return <SettingsCloudAI />;
      case "interface":
        return <SettingsInterface />;
      case "audio-subtitles":
        return (
          <SettingsAudioSubtitles
            settings={settings}
            setSettings={setSettings}
            audioDevices={audioDevices}
            selectedDeviceId={selectedDeviceId}
            setSelectedDeviceId={handleDeviceSelectionChange}
            isLoadingDevices={isLoadingDevices}
            onRefreshDevices={handleRefreshDevices}
            onRequestMicrophonePermission={handleRequestMicrophonePermission}
            hasMicrophonePermissionDetails={hasMicrophonePermissionDetails}
            microphonePermissionState={microphonePermissionState}
          />
        );
      case "data-management":
        return <SettingsDataManagement />;
      case "about-updates":
        return <SettingsAboutUpdates appVersion={appVersion} />;
    }
  };

  const renderNavButton = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    return (
      <button
        key={item.id}
        onClick={() => setActiveTab(item.id)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
          isActive
            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium shadow-sm"
            : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50"
        }`}
      >
        <Icon
          className={`w-4 h-4 ${
            isActive
              ? "text-blue-600 dark:text-blue-400"
              : "text-gray-400"
          }`}
        />
        <span className="flex-1 text-left">{item.label}</span>
        {isActive && <ChevronRight className="w-4 h-4 opacity-50" />}
      </button>
    );
  };

  const renderSectionLabel = (label: string) => (
    <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">
      {label}
    </div>
  );

  return (
    <div className="h-full flex bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">
            設置
          </h2>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {renderSectionLabel("主要")}
          {PRIMARY_NAV.map(renderNavButton)}
          {renderSectionLabel("其他")}
          {SECONDARY_NAV.map(renderNavButton)}
        </nav>
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-center text-gray-400">
            ClassNote AI v{appVersion}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="h-16 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-8 flex-shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-gray-800 dark:text-white">
              {current?.label}
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {current?.description}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saveStatus === "saving" && (
              <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-sm">
                <Save size={14} className="animate-pulse" />
                儲存中...
              </span>
            )}
            {saveStatus === "success" && (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm animate-in fade-in slide-in-from-right-4">
                <CheckCircle size={16} />
                已保存
              </span>
            )}
            {saveStatus === "error" && (
              <span className="flex items-center gap-1 text-red-500 text-sm">
                儲存失敗
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-3xl mx-auto">{renderContent()}</div>
        </div>
      </div>
    </div>
  );
}
