import { User, LogOut } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import s from "./ProfileView.module.css";

interface ProfileViewProps {
    onClose?: () => void;
}

export default function ProfileView({ onClose }: ProfileViewProps) {
    const { user, logout } = useAuth();

    return (
        <div className={s.root}>
            <div className={s.header}>
                <div>
                    <h2 className={s.title}>個人中心</h2>
                    <p className={s.description}>管理您的本機帳戶</p>
                </div>
                {onClose && (
                    <button onClick={onClose} className={s.closeBtn}>
                        關閉
                    </button>
                )}
            </div>

            <div className={s.card}>
                <div className={s.userBlock}>
                    <div className={s.avatar}>
                        <User size={22} />
                    </div>
                    <div className={s.userInfo}>
                        <h3 className={s.username}>{user?.username || '未登錄'}</h3>
                        <p className={s.lastLogin}>
                            上次登錄: {user?.last_login ? new Date(user.last_login).toLocaleString() : '-'}
                        </p>
                    </div>
                </div>
                <button onClick={logout} className={s.logoutBtn}>
                    <LogOut size={14} />
                    <span>登出</span>
                </button>
            </div>
        </div>
    );
}
