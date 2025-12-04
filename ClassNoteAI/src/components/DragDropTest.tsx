/**
 * 拖放功能測試組件
 * 用於快速測試拖放功能是否正常工作
 */
import { useState } from "react";
import DragDropZone from "./DragDropZone";

export default function DragDropTest() {
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);

  const handleFileDrop = (file: File) => {
    console.log("測試組件收到文件:", file.name);
    setDroppedFiles(prev => [...prev, file]);
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
          {droppedFiles.length > 0 && (
            <div className="mt-4">
              <p className="font-semibold mb-2">已接收的文件:</p>
              <ul className="list-disc list-inside">
                {droppedFiles.map((file, i) => (
                  <li key={i}>
                    {file.name} ({file.size} bytes, {file.type})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DragDropZone>
    </div>
  );
}


