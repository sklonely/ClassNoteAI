import { Mic, Cpu, CheckCircle2, XCircle, Loader2, Download, Trash2, AlertTriangle, Star } from "lucide-react";
import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Card } from "./shared";
import LocalModelExperimentalSettings from "./LocalModelExperimentalSettings";

type Variant = "int8" | "fp32";

interface VariantStatus {
  variant: Variant;
  present: boolean;
  bytes_on_disk: number;
  total_size: number;
  model_dir: string | null;
}

interface ParakeetStatus {
  variants: VariantStatus[];
  loaded_variant: Variant | null;
  model_loaded: boolean;
  session_active: boolean;
}

interface DownloadProgress {
  variant: Variant;
  file_index: number;
  file_name: string;
  file_size: number;
  file_downloaded: number;
  total_size: number;
  completed: boolean;
}

const VARIANT_DESCRIPTIONS: Record<Variant, { label: string; tagline: string; recommended: boolean }> = {
  int8: {
    label: "INT8 (推薦)",
    tagline: "8-bit 量化，~852 MB。WER 8.01% (vs FP32 8.03%) — 精度差距在誤差內，但下載快 3 倍。",
    recommended: true,
  },
  fp32: {
    label: "FP32",
    tagline: "原版浮點，~2.5 GB。給對精度有極致要求 / 想做 A/B 比較的進階使用者。",
    recommended: false,
  },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Settings → 本地轉錄. v2.1 ASR is Nemotron-Speech-Streaming-EN-0.6B
 * (NVIDIA cache-aware streaming RNN-T) running in-process via the
 * parakeet-rs crate. Two quantization variants ship side-by-side:
 *   * INT8 (default, 852 MB) — 0.02% WER worse than FP32, fits a
 *     fresh Windows install without scaring the user.
 *   * FP32 (2.5 GB) — power-user / debugging option.
 */
export default function SettingsLocalTranscription() {
  const [status, setStatus] = useState<ParakeetStatus | null>(null);
  const [actionVariant, setActionVariant] = useState<Variant | null>(null);
  const [actionType, setActionType] = useState<"downloading" | "loading" | "unloading" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [perFileBytes, setPerFileBytes] = useState<Record<string, number>>({});
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<ParakeetStatus>("get_parakeet_status");
      setStatus(s);
    } catch (e) {
      console.warn("[SettingsLocalTranscription] get_parakeet_status failed:", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
    let cancelled = false;
    void (async () => {
      const un = await listen<DownloadProgress>("parakeet-download-progress", (event) => {
        const p = event.payload;
        const key = `${p.variant}/${p.file_name}`;
        setPerFileBytes((prev) => ({ ...prev, [key]: p.file_downloaded }));
        if (p.completed) void refresh();
      });
      if (cancelled) un();
      else unlistenRef.current = un;
    })();
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [refresh]);

  const isBusy = actionType !== null;

  const handleDownload = useCallback(
    async (variant: Variant) => {
      setActionVariant(variant);
      setActionType("downloading");
      setMessage(null);
      try {
        const result = await invoke<string>("parakeet_download_model", { variant });
        setMessage(result);
        await refresh();
      } catch (e) {
        setMessage(`下載失敗: ${String((e as { message?: string })?.message ?? e)}`);
      } finally {
        setActionType(null);
        setActionVariant(null);
      }
    },
    [refresh],
  );

  const handleLoad = useCallback(
    async (variant: Variant) => {
      setActionVariant(variant);
      setActionType("loading");
      setMessage(null);
      try {
        await invoke("parakeet_load_model", { variant });
        setMessage(`${variant.toUpperCase()} 已載入記憶體`);
        await refresh();
      } catch (e) {
        setMessage(`載入失敗: ${String((e as { message?: string })?.message ?? e)}`);
      } finally {
        setActionType(null);
        setActionVariant(null);
      }
    },
    [refresh],
  );

  const handleUnload = useCallback(async () => {
    setActionType("unloading");
    try {
      await invoke("parakeet_unload_model");
      setMessage("模型已從記憶體卸載");
      await refresh();
    } catch (e) {
      setMessage(`卸載失敗: ${String((e as { message?: string })?.message ?? e)}`);
    } finally {
      setActionType(null);
      setActionVariant(null);
    }
  }, [refresh]);

  const renderVariantRow = (vs: VariantStatus) => {
    const desc = VARIANT_DESCRIPTIONS[vs.variant];
    const isLoaded = status?.loaded_variant === vs.variant;
    const isMyAction = actionVariant === vs.variant;
    const myActionType = isMyAction ? actionType : null;
    const downloadPercent = vs.total_size > 0 ? Math.min(100, (vs.bytes_on_disk / vs.total_size) * 100) : 0;

    return (
      <div
        key={vs.variant}
        className={`rounded-lg border p-3 space-y-3 ${
          isLoaded
            ? "border-green-400 dark:border-green-600 bg-green-50/50 dark:bg-green-900/10"
            : "border-gray-200 dark:border-gray-700"
        }`}
      >
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-blue-500" />
            {desc.label}
            {desc.recommended && <Star className="w-3.5 h-3.5 text-amber-500" />}
          </span>
          {isLoaded ? (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs">
              <CheckCircle2 className="w-4 h-4" />
              已載入
            </span>
          ) : vs.present ? (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs">
              <AlertTriangle className="w-4 h-4" />
              已下載，未載入
            </span>
          ) : (
            <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-xs">
              <XCircle className="w-4 h-4" />
              未下載
            </span>
          )}
        </div>

        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{desc.tagline}</p>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
            <span>磁碟大小</span>
            <span className="font-mono">
              {formatBytes(vs.bytes_on_disk)} / {formatBytes(vs.total_size)}
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${vs.present ? "bg-green-500" : "bg-blue-500"} transition-all duration-300`}
              style={{ width: `${downloadPercent}%` }}
            />
          </div>
        </div>

        {myActionType === "downloading" && (
          <div className="space-y-1 text-xs font-mono text-gray-500 dark:text-gray-400">
            {Object.entries(perFileBytes)
              .filter(([key]) => key.startsWith(`${vs.variant}/`))
              .map(([key, bytes]) => (
                <div key={key} className="flex justify-between">
                  <span>{key.split("/")[1]}</span>
                  <span>{formatBytes(bytes)}</span>
                </div>
              ))}
          </div>
        )}

        <div className="flex gap-2">
          {!vs.present ? (
            <button
              onClick={() => handleDownload(vs.variant)}
              disabled={isBusy}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm transition-colors"
            >
              {myActionType === "downloading" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {myActionType === "downloading" ? "下載中…" : `下載 (${formatBytes(vs.total_size)})`}
            </button>
          ) : isLoaded ? (
            <button
              onClick={handleUnload}
              disabled={isBusy || status?.session_active}
              title={status?.session_active ? "請先停止錄音" : ""}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white text-sm transition-colors"
            >
              {myActionType === "unloading" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              卸載
            </button>
          ) : (
            <button
              onClick={() => handleLoad(vs.variant)}
              disabled={isBusy || status?.session_active}
              title={status?.session_active ? "請先停止錄音" : ""}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white text-sm transition-colors"
            >
              {myActionType === "loading" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Cpu className="w-4 h-4" />
              )}
              {status?.model_loaded ? "切換到此版本" : "載入到記憶體"}
            </button>
          )}
        </div>

        {vs.model_dir && (
          <div className="text-xs text-gray-400 dark:text-gray-500 font-mono break-all">{vs.model_dir}</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Card
        title="本地轉錄模型（Nemotron Streaming）"
        icon={<Mic className="w-5 h-5 text-blue-500" />}
        subtitle="NVIDIA cache-aware streaming RNN-T (0.6B 參數，純英文)。560 ms chunk 即時轉錄，純 Rust 進程內推理。"
      >
        <div className="space-y-4">
          {status?.variants?.map(renderVariantRow)}
          {message && (
            <div className="text-xs text-gray-600 dark:text-gray-400 px-1">{message}</div>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            兩個版本可以同時下載並切換比較。INT8 是預設 — WER 差距 (8.01% vs 8.03%)
            在誤差內，但下載量小 3 倍。第一次錄音時會自動載入磁碟上偵測到的版本
            (INT8 優先)，之後開啟應用程式時會背景預先載入。
          </p>
          <LocalModelExperimentalSettings />
        </div>
      </Card>
    </div>
  );
}
