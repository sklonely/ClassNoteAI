import { open } from "@tauri-apps/plugin-dialog";

/**
 * 選擇 PDF 文件
 * @returns 選中的文件路徑，如果取消則返回 null
 */
export async function selectPDFFile(): Promise<string | null> {
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
      return selected;
    }

    return null;
  } catch (error) {
    console.error("文件選擇失敗:", error);
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

