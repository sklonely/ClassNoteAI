/**
 * H18 ProfilePage · v0.7.0 Phase 6.7
 *
 * 對應 docs/design/h18-deep/h18-nav-pages.jsx ProfilePage L990+。
 * 取代 SettingsView / ProfileView / TrashView (legacy)。
 *
 * 範圍：8 sub-pane (Overview + 7 settings)。本 CP 重點是 H18 視覺
 * 1:1，控件 wiring 多為留白 — 切換 / 寫入 storageService 等到下個
 * "wiring audit" CP 一起做。
 *
 * Sub-panes:
 *  - overview     · 學習總覽 + 登出 (real wire)
 *  - transcribe   · 本地轉錄 (Parakeet) 設定 (留白)
 *  - translate    · 翻譯 (Gemma / Google / CT2) (留白)
 *  - cloud        · 雲端 LLM provider (留白)
 *  - appearance   · 介面與顯示 (theme / 主頁佈局) (theme 接 toggleTheme)
 *  - audio        · 音訊與字幕 (留白)
 *  - data         · 匯入匯出 + 回收桶 (TrashView 併進來，部分 wired)
 *  - about        · 版本 / 關於 / setup wizard 重置 (留白)
 */

import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { applyTheme } from '../../utils/theme';
import s from './ProfilePage.module.css';
import {
    POverview,
    PTranscribe,
    PTranslate,
    PCloud,
    PAppearance,
    PAudio,
    PData,
    PAbout,
} from './ProfilePanes';

export type ProfileTab =
    | 'overview'
    | 'transcribe'
    | 'translate'
    | 'cloud'
    | 'appearance'
    | 'audio'
    | 'data'
    | 'about';

export interface ProfilePageProps {
    onBack: () => void;
    effectiveTheme: 'light' | 'dark';
    onToggleTheme: () => void;
}

interface NavItem {
    id: ProfileTab;
    label: string;
    hint: string;
}

const PERSONAL: NavItem[] = [
    { id: 'overview', label: '總覽', hint: '學習成就' },
];

const SETTINGS: NavItem[] = [
    { id: 'transcribe', label: '本地轉錄', hint: 'Parakeet · GPU' },
    { id: 'translate', label: '翻譯', hint: 'Gemma · Google' },
    { id: 'cloud', label: '雲端 AI 助理', hint: '摘要 · Q&A · OCR' },
    { id: 'appearance', label: '介面與顯示', hint: 'AI · 版面' },
    { id: 'audio', label: '音訊與字幕', hint: '麥克風 · 字幕' },
    { id: 'data', label: '資料管理', hint: '匯入匯出 · 回收桶' },
    { id: 'about', label: '關於與更新', hint: '版本 · 診斷' },
];

export default function ProfilePage({
    onBack,
    effectiveTheme,
    onToggleTheme,
}: ProfilePageProps) {
    const [tab, setTab] = useState<ProfileTab>('overview');
    const { user, logout } = useAuth();

    const username = user?.username || 'Unknown';
    const initial = username.charAt(0).toUpperCase();

    const handleLogout = () => {
        const ok = window.confirm(
            '確定要登出？\n登出後需重新輸入用戶名才能繼續使用。本機資料不會被刪除，下次登入相同名稱即可繼續。',
        );
        if (ok) {
            logout();
        }
    };

    return (
        <div className={s.page}>
            <aside className={s.sidebar}>
                <button type="button" onClick={onBack} className={s.backBtn}>
                    ← 返回
                </button>
                <div className={s.userRow}>
                    <div className={s.avatar}>{initial}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={s.userName}>{username}</div>
                        <div className={s.userEmail}>本機帳號</div>
                    </div>
                </div>

                <div className={s.sectionHead}>個人</div>
                {PERSONAL.map((item) => (
                    <Tab
                        key={item.id}
                        item={item}
                        active={tab === item.id}
                        onClick={() => setTab(item.id)}
                    />
                ))}

                <div className={s.sectionHead}>設定</div>
                {SETTINGS.map((item) => (
                    <Tab
                        key={item.id}
                        item={item}
                        active={tab === item.id}
                        onClick={() => setTab(item.id)}
                    />
                ))}
            </aside>

            <main className={s.content}>
                {tab === 'overview' && (
                    <POverview
                        username={username}
                        initial={initial}
                        onLogout={handleLogout}
                    />
                )}
                {tab === 'transcribe' && <PTranscribe />}
                {tab === 'translate' && <PTranslate />}
                {tab === 'cloud' && <PCloud />}
                {tab === 'appearance' && (
                    <PAppearance
                        effectiveTheme={effectiveTheme}
                        onToggleTheme={onToggleTheme}
                        applyTheme={applyTheme}
                    />
                )}
                {tab === 'audio' && <PAudio />}
                {tab === 'data' && <PData />}
                {tab === 'about' && <PAbout />}
            </main>
        </div>
    );
}

function Tab({
    item,
    active,
    onClick,
}: {
    item: NavItem;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`${s.tab} ${active ? s.tabActive : ''}`}
        >
            {item.label}
            <div className={s.tabHint}>{item.hint}</div>
        </button>
    );
}
