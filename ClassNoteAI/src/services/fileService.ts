import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

/**
 * 選擇 PDF 文件並讀取其內容
 * @returns 包含文件路徑和 ArrayBuffer 的對象，如果取消則返回 null
 */
export async function selectPDFFile(): Promise<{ path: string; data: ArrayBuffer } | null> {
  try {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "PDF",
          extensions: ["pdf"],
        },
      ],
      title: "選擇 PDF 文件",
    });

    if (selected && typeof selected === "string") {
      // 使用 Tauri 命令讀取文件內容
      const fileData = await invoke<number[]>("read_binary_file", { path: selected });
      // 將 Vec<u8> 轉換為 ArrayBuffer
      const arrayBuffer = new Uint8Array(fileData).buffer;
      return { path: selected, data: arrayBuffer };
    }

    return null;
  } catch (error) {
    console.error("文件選擇失敗:", error);
    return null;
  }
}

/**
 * Pick a media file to import into the current lecture. We only need
 * the path -- import_video_for_lecture on the Rust side copies the
 * bytes itself. Keeping the large file off the JS heap matters for
 * 500 MB+ lecture recordings.
 */
export async function selectVideoFile(): Promise<string | null> {
  try {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'Video or Audio',
          extensions: ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', 'wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'],
        },
      ],
      title: '選擇影片檔案',
    });
    if (selected && typeof selected === 'string') return selected;
    return null;
  } catch (error) {
    console.error('影片選擇失敗:', error);
    return null;
  }
}

/**
 * 選擇多個 PDF 文件
 * @returns 選中的文件路徑數組
 */
export async function selectMultiplePDFFiles(): Promise<string[]> {
  try {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "PDF",
          extensions: ["pdf"],
        },
      ],
      title: "選擇 PDF 文件",
    });

    if (Array.isArray(selected)) {
      return selected;
    }

    return [];
  } catch (error) {
    console.error("文件選擇失敗:", error);
    return [];
  }
}


/**
 * 直接讀取 PDF 文件內容
 * @param path 文件路徑
 * @returns 包含文件路徑和 ArrayBuffer 的對象，如果失敗則返回 null
 */
export async function readPDFFile(path: string): Promise<{ path: string; data: ArrayBuffer } | null> {
  try {
    // 使用 Tauri 命令讀取文件內容
    const fileData = await invoke<number[]>("read_binary_file", { path });
    // 將 Vec<u8> 轉換為 ArrayBuffer
    const arrayBuffer = new Uint8Array(fileData).buffer;
    return { path, data: arrayBuffer };
  } catch (error) {
    console.error("讀取 PDF 文件失敗:", error);
    return null;
  }
}
