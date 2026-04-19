/**
 * 拖放功能測試組件
 * 用於快速測試拖放功能是否正常工作
 */
import { useState } from "react";
import DragDropZone from "./DragDropZone";

export default function DragDropTest() {
  const [droppedPaths, setDroppedPaths] = useState<string[]>([]);

  const handleFileDrop = (paths: string[]) => {
    console.log("測試組件收到檔案:", paths);
    setDroppedPaths(prev => [...prev, ...paths]);
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">拖放功能測試</h2>
      <DragDropZone
        onFileDrop={handleFileDrop}
        className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 min-h-[400px]"
      >
        <div className="text-center">
          <p className="text-lg mb-4">拖放文件到此處測試</p>
          {droppedPaths.length > 0 && (
            <div className="mt-4">
              <p className="font-semibold mb-2">已接收的檔案:</p>
              <ul className="list-disc list-inside">
                {droppedPaths.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DragDropZone>
    </div>
  );
}


