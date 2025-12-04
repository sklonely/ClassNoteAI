/**
 * 拖放功能診斷工具
 * 用於排查拖放問題
 */

export function logDragEvent(_event: string, _e: React.DragEvent | DragEvent) {
  // 拖放診斷已禁用
  // 如果需要重新啟用，取消下面的註釋
  /*
  if (!e.dataTransfer) {
    console.warn(`[拖放診斷] ${event}: dataTransfer 為 null`);
    return;
  }

  console.log(`[拖放診斷] ${event}:`, {
    types: Array.from(e.dataTransfer.types),
    files: e.dataTransfer.files.length,
    items: e.dataTransfer.items.length,
    effectAllowed: e.dataTransfer.effectAllowed,
    dropEffect: e.dataTransfer.dropEffect,
  });

  // 詳細記錄 files
  if (e.dataTransfer.files.length > 0) {
    console.log(`[拖放診斷] Files:`, Array.from(e.dataTransfer.files).map(f => ({
      name: f.name,
      type: f.type,
      size: f.size,
      lastModified: new Date(f.lastModified).toISOString(),
    })));
  }

  // 詳細記錄 items
  if (e.dataTransfer.items.length > 0) {
    console.log(`[拖放診斷] Items:`, Array.from(e.dataTransfer.items).map((item, i) => ({
      index: i,
      kind: item.kind,
      type: item.type,
    })));
  }
  */
}

export function testDragDropSupport(): boolean {
  const div = document.createElement('div');
  const hasDragDrop = 'draggable' in div || ('ondragstart' in div && 'ondrop' in div);
  // 拖放診斷已禁用
  // console.log('[拖放診斷] 瀏覽器支持拖放:', hasDragDrop);
  return hasDragDrop;
}

