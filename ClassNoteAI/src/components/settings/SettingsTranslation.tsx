import {
  Languages,
  HardDrive,
  Cloud,
  Cpu,
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Play,
  Square,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppSettings } from "../../types";
import { getBuildFeatures, type BuildFeatures } from "../../services/buildFeaturesService";
import { Card, SegmentedControl } from "./shared";

interface GemmaStatus {
  binary_path: string | null;
  model_path: string;
  model_present: boolean;
  model_size_bytes: number;
  model_url: string;
  sidecar_running: boolean;
}

interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
  speed_mbps: number;
  eta_seconds: number | null;
}

type SidecarBringUp = "already_running" | "spawned" | "timeout" | "binary_not_found" | "spawn_error";

function fmtGB(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
function fmtMBps(mbps: number): string {
  return `${mbps.toFixed(1)} MB/s`;
}
function fmtETA(seconds: number | null): string {
  if (seconds == null) return "計算中…";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

interface Props {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
}

type SourceLang = NonNullable<AppSettings["translation"]>["source_language"];

export default function SettingsTranslation({ settings, setSettings }: Props) {
  // Default to gemma if no saved provider — historical 'local' default
  // surfaces "translation failed" toasts on dev builds without nmt-local.
  const provider = settings.translation?.provider || "gemma";
  const gemmaEndpoint = settings.translation?.gemma_endpoint || "";

  // Build feature flags decide which provider tiles to show. Without this
  // a dev build without `nmt-local` would still expose "本地 ONNX" and the
  // user would silently land on a backend that always errors.
  const [features, setFeatures] = useState<BuildFeatures | null>(null);
  useEffect(() => {
    getBuildFeatures().then(setFeatures).catch(() => {
      /* fall back to showing all tiles */
    });
  }, []);

  // Health probe for the Gemma sidecar — re-checks when the endpoint
  // string changes or when the user switches to the gemma provider.
  const [gemmaHealth, setGemmaHealth] = useState<"unknown" | "checking" | "ok" | "down">(
    "unknown"
  );
  const [status, setStatus] = useState<GemmaStatus | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [sidecarAction, setSidecarAction] = useState<"idle" | "starting" | "stopping">("idle");
  const [sidecarMessage, setSidecarMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await invoke<GemmaStatus>("get_gemma_status");
      setStatus(s);
    } catch (e) {
      console.warn("[SettingsTranslation] get_gemma_status failed:", e);
    }
  }, []);

  useEffect(() => {
    if (provider !== "gemma") {
      setGemmaHealth("unknown");
      return;
    }
    let cancelled = false;
    setGemmaHealth("checking");
    refreshStatus();
    (async () => {
      try {
        const ok = await invoke<boolean>("check_gemma_server", {
          endpoint: gemmaEndpoint || null,
        });
        if (!cancelled) setGemmaHealth(ok ? "ok" : "down");
      } catch {
        if (!cancelled) setGemmaHealth("down");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, gemmaEndpoint, refreshStatus]);

  // Subscribe to download progress events (emitted by `download_gemma_model`).
  useEffect(() => {
    const unlisten = listen<DownloadProgress>("gemma-download-progress", (event) => {
      setDownloadProgress(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setDownloadError(null);
    setDownloadProgress({ downloaded: 0, total: status?.model_size_bytes ?? 0, percent: 0, speed_mbps: 0, eta_seconds: null });
    try {
      await invoke<string>("download_gemma_model");
      await refreshStatus();
    } catch (e) {
      setDownloadError(String((e as { message?: string })?.message ?? e));
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  }, [status?.model_size_bytes, refreshStatus]);

  const handleStartSidecar = useCallback(async () => {
    if (!status?.model_present) return;
    setSidecarAction("starting");
    setSidecarMessage(null);
    try {
      const result = await invoke<SidecarBringUp>("start_gemma_sidecar", {
        modelPath: status.model_path,
        port: null,
      });
      const messages: Record<SidecarBringUp, string> = {
        already_running: "sidecar 已在執行",
        spawned: "sidecar 已啟動",
        timeout: "/health 在 30 秒內沒回應 — 看看 GPU 是不是滿了",
        binary_not_found: "找不到 llama-server 二進位（既不在 bundle、dev path 也不在 PATH）",
        spawn_error: "spawn 失敗（權限 / 缺 DLL？）",
      };
      setSidecarMessage(messages[result]);
      await refreshStatus();
      setGemmaHealth(result === "spawned" || result === "already_running" ? "ok" : "down");
    } catch (e) {
      setSidecarMessage(String((e as { message?: string })?.message ?? e));
    } finally {
      setSidecarAction("idle");
    }
  }, [status?.model_present, status?.model_path, refreshStatus]);

  const handleStopSidecar = useCallback(async () => {
    setSidecarAction("stopping");
    try {
      await invoke("stop_gemma_sidecar");
      setSidecarMessage("sidecar 已停止");
      await refreshStatus();
      setGemmaHealth("down");
    } catch (e) {
      setSidecarMessage(String((e as { message?: string })?.message ?? e));
    } finally {
      setSidecarAction("idle");
    }
  }, [refreshStatus]);

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
                // 本地 ONNX 只在 build 包含 nmt-local feature 時顯示。
                // 大部分 dev build 沒包，列出來只會誤導使用者選擇必失敗
                // 的選項。Production CPU/CUDA 安裝包都會顯式啟用，所以
                // 一般使用者照看得到。
                ...(features === null || features.nmt_local
                  ? [
                      {
                        value: "local",
                        label: "本地 ONNX",
                        icon: <HardDrive size={16} />,
                        hint: "離線、CPU 即可、技術詞較弱",
                      },
                    ]
                  : []),
                {
                  value: "gemma",
                  label: "TranslateGemma",
                  icon: <Cpu size={16} />,
                  hint: "本地 LLM、需 GPU + sidecar",
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
                    provider: v as "local" | "gemma" | "google",
                  },
                })
              }
            />
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
            {provider === "local" && (
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                <p>
                  本地 ONNX (M2M100) 已從 v2 重構中移除。請改選
                  <strong> TranslateGemma</strong>（本地 LLM，需 GPU + sidecar）
                  或 <strong>Google Cloud</strong>。
                </p>
                <p className="text-xs">
                  M2M100 在 CS / 技術詞翻譯品質明顯弱於 TranslateGemma
                  （e.g. <code>stack</code> 會被翻成「斯塔克」），且維持 ct2rs
                  + sentencepiece 的 build pipeline 是 dev 體驗的主要痛點。
                </p>
              </div>
            )}
            {provider === "gemma" && (
              <div className="space-y-4">
                {/* Connection status */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">連線狀態：</span>
                  {gemmaHealth === "checking" && (
                    <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      檢查中…
                    </span>
                  )}
                  {gemmaHealth === "ok" && (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="w-4 h-4" />
                      sidecar 已連線
                    </span>
                  )}
                  {gemmaHealth === "down" && (
                    <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                      <XCircle className="w-4 h-4" />
                      sidecar 未啟動
                    </span>
                  )}
                </div>

                {/* Model file status + download */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">模型檔案</span>
                    {status?.model_present ? (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs">
                        <CheckCircle2 className="w-4 h-4" />
                        已下載 ({fmtGB(status.model_size_bytes)})
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs">
                        <AlertTriangle className="w-4 h-4" />
                        需要下載 ({status ? fmtGB(status.model_size_bytes) : "?"})
                      </span>
                    )}
                  </div>
                  {status?.model_path && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all">
                      {status.model_path}
                    </div>
                  )}
                  {!status?.model_present && (
                    <button
                      onClick={handleDownload}
                      disabled={downloading}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm transition-colors"
                    >
                      {downloading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      {downloading ? "下載中…" : "下載 TranslateGemma 4B 模型"}
                    </button>
                  )}
                  {downloading && downloadProgress && (
                    <div className="space-y-1.5">
                      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-200"
                          style={{ width: `${downloadProgress.percent.toFixed(1)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                        <span>
                          {downloadProgress.percent.toFixed(1)}% ·{" "}
                          {(downloadProgress.downloaded / 1_000_000_000).toFixed(2)} /{" "}
                          {fmtGB(downloadProgress.total)}
                        </span>
                        <span>
                          {fmtMBps(downloadProgress.speed_mbps)} · ETA{" "}
                          {fmtETA(downloadProgress.eta_seconds)}
                        </span>
                      </div>
                    </div>
                  )}
                  {downloadError && (
                    <div className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>{downloadError}</span>
                    </div>
                  )}
                </div>

                {/* Sidecar binary + lifecycle */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">llama-server 二進位</span>
                    {status?.binary_path ? (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs">
                        <CheckCircle2 className="w-4 h-4" />
                        已找到
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-600 dark:text-red-400 text-xs">
                        <XCircle className="w-4 h-4" />
                        未找到
                      </span>
                    )}
                  </div>
                  {status?.binary_path ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all">
                      {status.binary_path}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      安裝包尚未 bundle llama-server.exe；dev 環境請放在
                      <code className="mx-1">D:\tools\llama-cpp\bin\</code>
                      或加進 PATH。Production 安裝包會自動內含。
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleStartSidecar}
                      disabled={
                        !status?.model_present ||
                        !status?.binary_path ||
                        sidecarAction === "starting" ||
                        gemmaHealth === "ok"
                      }
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white text-sm transition-colors"
                    >
                      {sidecarAction === "starting" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      啟動 sidecar
                    </button>
                    <button
                      onClick={handleStopSidecar}
                      disabled={
                        sidecarAction === "stopping" ||
                        (!status?.sidecar_running && gemmaHealth !== "ok")
                      }
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white text-sm transition-colors"
                    >
                      {sidecarAction === "stopping" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                      停止 sidecar
                    </button>
                  </div>
                  {sidecarMessage && (
                    <div className="text-xs text-gray-600 dark:text-gray-400">{sidecarMessage}</div>
                  )}
                </div>

                {/* Optional endpoint override */}
                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-700 dark:text-gray-300 font-medium">
                    進階設定
                  </summary>
                  <div className="mt-2 space-y-2">
                    <label className="block text-xs font-medium">
                      llama-server 端點（選填，預設 http://127.0.0.1:8080）
                    </label>
                    <input
                      type="text"
                      value={gemmaEndpoint}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          translation: {
                            ...settings.translation,
                            gemma_endpoint: e.target.value,
                          },
                        })
                      }
                      placeholder="http://127.0.0.1:8080"
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-xs"
                    />
                  </div>
                </details>

                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  TranslateGemma 4B Q4_K_M（Google，2026-01 釋出，Gemma 3 為底翻譯特化）。
                  繁體中文品質與 CS 技術詞顯著優於本地 ONNX。需 GPU + 約 3 GB VRAM；
                  CPU only 可跑但慢。模型下載自{" "}
                  <code>SandLogicTechnologies/translategemma-4b-it-GGUF</code>。
                </p>
              </div>
            )}
            {provider === "google" && (
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
