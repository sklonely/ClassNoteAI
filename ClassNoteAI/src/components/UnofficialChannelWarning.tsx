/**
 * Modal shown before the user triggers an unofficial-channel sign-in
 * (currently used for ChatGPT OAuth via the Codex client_id).
 */

import { AlertTriangle } from 'lucide-react';
import s from './UnofficialChannelWarning.module.css';

export interface UnofficialChannelWarningProps {
    providerName: string;
    onContinue: () => void;
    onCancel: () => void;
}

export default function UnofficialChannelWarning({
    providerName,
    onContinue,
    onCancel,
}: UnofficialChannelWarningProps) {
    return (
        <div className={s.backdrop}>
            <div className={s.card}>
                <div className={s.header}>
                    <div className={s.icon}>
                        <AlertTriangle />
                    </div>
                    <div className={s.headerText}>
                        <div className={s.eyebrow}>UNOFFICIAL CHANNEL</div>
                        <h3 className={s.title}>使用非官方管道登入 {providerName}</h3>
                    </div>
                </div>

                <div className={s.body}>
                    <p>
                        此路徑透過 OpenAI 為 Codex CLI 公開的 OAuth client_id 來重用你的 ChatGPT 訂閱配額，<strong>並非 OpenAI 官方為第三方應用提供的 API 通道</strong>。
                    </p>
                    <p>
                        可能風險：OpenAI 若調整 Codex 的內部端點或輪替 client_id，此路徑會突然失效。若需長期穩定，請改用 GitHub Models（Copilot Pro 訂閱）或 OpenAI Platform API key。
                    </p>
                </div>

                <div className={s.actions}>
                    <button
                        type="button"
                        onClick={onCancel}
                        className={`${s.btn} ${s.btnCancel}`}
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={onContinue}
                        className={`${s.btn} ${s.btnPrimary}`}
                    >
                        我了解，繼續登入
                    </button>
                </div>
            </div>
        </div>
    );
}
