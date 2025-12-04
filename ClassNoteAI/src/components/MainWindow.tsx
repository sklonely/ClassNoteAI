import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, FileText, Settings, Moon, Sun, FlaskConical } from "lucide-react";
import { applyTheme, getSystemTheme } from "../utils/theme";

export default function MainWindow({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [theme, setTheme] = useState<"light" | "dark">(getSystemTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  const navItems = [
    { path: "/", label: "上課", icon: BookOpen },
    { path: "/notes", label: "筆記", icon: FileText },
    { path: "/settings", label: "設置", icon: Settings },
    { path: "/test", label: "測試", icon: FlaskConical },
    { path: "/test-translation", label: "翻譯測試", icon: FlaskConical },
  ];

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100">
      {/* 頂部導航欄 */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">ClassNote AI</h1>
        </div>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${isActive
                    ? "bg-blue-500 text-white"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="切換主題"
          >
            {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
          </button>
        </div>
      </header>

      {/* 狀態欄 */}
      <div className="px-6 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            已連接
            <span className="w-2 h-2 rounded-full bg-blue-500 ml-2"></span>
            模型就緒
          </span>
        </div>
      </div>

      {/* 主內容區域 */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}

