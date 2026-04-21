import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { User, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

interface LoginScreenProps {
    onComplete: () => void;
}

export default function LoginScreen({ onComplete }: LoginScreenProps) {
    const { login, register } = useAuth();
    const [username, setUsername] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async () => {
        if (!username.trim()) return;
        setIsLoading(true);
        setError(null);
        try {
            // First try to login (check if exists)
            const exists = await login(username);
            if (exists) {
                onComplete();
            } else {
                // If not, ask to register or auto-register?
                // User requirement: "Register or Login".
                // I'll assume auto-register for local-first seamlessness, 
                // or prompt. For now, let's just register if login fails?
                // Actually `authService.login` checks `check_local_user`.
                // If it returns false, we should tell user "User not found, creating new account?".
                // Or just `register` which is an UPSERT basically?
                // `register` calls `register_local_user` (INSERT).

                // Let's try register if login false.
                try {
                    await register(username);
                    onComplete();
                } catch (regError) {
                    setError('無法建立帳號');
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            <div className="w-full max-w-md p-8 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 animate-in fade-in zoom-in duration-300">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                        <User className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                        歡迎使用 ClassNote AI
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400">
                        請輸入用戶名以繼續
                    </p>
                </div>

                <div className="space-y-4">
                    <div>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                            placeholder="用戶名 (Username)"
                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                            autoFocus
                        />
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleLogin}
                        disabled={isLoading || !username.trim()}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-all transform active:scale-[0.98]"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                處理中...
                            </>
                        ) : (
                            <>
                                開始使用
                                <ArrowRight className="w-5 h-5" />
                            </>
                        )}
                    </button>

                    <p className="text-xs text-center text-gray-400 mt-4">
                        您的數據將存儲在本地，並可同步至伺服器。
                    </p>
                </div>
            </div>
        </div>
    );
}
