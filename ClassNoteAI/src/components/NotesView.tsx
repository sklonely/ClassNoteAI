import { useState } from "react";
import { Download, Search } from "lucide-react";

export default function NotesView() {
  const [selectedLecture, setSelectedLecture] = useState<string | null>(null);

  // 模擬數據
  const lectures = [
    { id: "1", title: "計算機科學導論 - 第1課", date: "2025-12-01", duration: 3600 },
    { id: "2", title: "數據結構與算法", date: "2025-11-28", duration: 5400 },
    { id: "3", title: "機器學習基礎", date: "2025-11-25", duration: 7200 },
  ];

  const handleExport = (format: "markdown" | "pdf") => {
    // TODO: 實現導出功能
    console.log(`導出為 ${format}`);
  };

  return (
    <div className="flex h-full bg-gray-50 dark:bg-gray-900">
      {/* 左側課程列表 */}
      <div className="w-80 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="搜索課程..."
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-auto">
          {lectures.map((lecture) => (
            <div
              key={lecture.id}
              onClick={() => setSelectedLecture(lecture.id)}
              className={`p-4 border-b border-gray-200 dark:border-gray-700 cursor-pointer transition-colors ${
                selectedLecture === lecture.id
                  ? "bg-primary/10 border-l-4 border-l-primary"
                  : "hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              <h3 className="font-semibold mb-1">{lecture.title}</h3>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                <div>{new Date(lecture.date).toLocaleDateString("zh-CN")}</div>
                <div>{Math.floor(lecture.duration / 60)} 分鐘</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右側筆記內容 */}
      <div className="flex-1 flex flex-col">
        {selectedLecture ? (
          <>
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {lectures.find((l) => l.id === selectedLecture)?.title}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => handleExport("markdown")}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  <Download size={18} />
                  導出 Markdown
                </button>
                <button
                  onClick={() => handleExport("pdf")}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                >
                  <Download size={18} />
                  導出 PDF
                </button>
              </div>
            </div>
            
            <div className="flex-1 p-6 overflow-auto">
              <div className="max-w-4xl mx-auto prose dark:prose-invert">
                <h1>課程筆記</h1>
                <p className="text-gray-600 dark:text-gray-400">
                  筆記內容將顯示在這裡...
                </p>
                {/* TODO: 實現 Markdown 渲染 */}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
            <div className="text-center">
              <p className="text-lg mb-2">選擇一個課程查看筆記</p>
              <p className="text-sm">或等待課程結束後自動生成筆記</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

