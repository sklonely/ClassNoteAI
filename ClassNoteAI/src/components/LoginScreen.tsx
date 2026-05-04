import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { User, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import s from './LoginScreen.module.css';

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
        <div data-agent-id="auth.login" className={s.root}>
            <div className={s.card}>
                <div className={s.head}>
                    <div className={s.avatar}>
                        <User size={20} />
                    </div>
                    <h1 className={s.title}>歡迎使用 ClassNote AI</h1>
                    <p className={s.hint}>請輸入用戶名以繼續</p>
                </div>

                <div className={s.field}>
                    <input
                        data-agent-id="auth.username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                        placeholder="用戶名 (Username)"
                        className={s.input}
                        autoFocus
                    />
                </div>

                {error && (
                    <div className={s.error}>
                        <AlertCircle size={14} />
                        {error}
                    </div>
                )}

                <button
                    data-agent-id="auth.submit"
                    onClick={handleLogin}
                    disabled={isLoading || !username.trim()}
                    className={s.btn}
                >
                    {isLoading ? (
                        <>
                            <Loader2 size={14} className="animate-spin" />
                            處理中
                        </>
                    ) : (
                        <>
                            開始使用
                            <ArrowRight size={14} />
                        </>
                    )}
                </button>

                <p className={s.footnote}>您的數據將存儲在本地，並可同步至伺服器</p>
            </div>
        </div>
    );
}
