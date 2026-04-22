import { User, LogOut } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

interface ProfileViewProps {
    onClose?: () => void;
}

export default function ProfileView({ onClose }: ProfileViewProps) {
    const { user, logout } = useAuth();

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-8 animate-in fade-in duration-300">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-2xl font-bold">個人中心</h2>
                    <p className="text-gray-500 dark:text-gray-400">管理您的本機帳戶</p>
                </div>
                {onClose && (
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                        關閉
                    </button>
                )}
            </div>

            {/* User Card */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-300">
                            <User size={32} />
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold">{user?.username || '未登錄'}</h3>
                            <p className="text-sm text-gray-500">上次登錄: {user?.last_login ? new Date(user.last_login).toLocaleString() : '-'}</p>
                        </div>
                    </div>
                    <button
                        onClick={logout}
                        className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors border border-red-200 dark:border-red-800"
                    >
                        <LogOut size={18} />
                        <span>登出</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
