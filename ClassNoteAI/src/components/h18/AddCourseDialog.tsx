/**
 * H18 AddCourseDialog · v0.7.0 Phase 6.3
 *
 * 對應 docs/design/h18-deep/h18-nav-pages.jsx L774-913 (AddCourseDialog).
 * 取代 legacy CourseCreationDialog.tsx 的 P6.3 入口。
 *
 * 三條 source 路徑：
 *  - 貼文字 → onSubmit(title, keywords, undefined, description)
 *            backend storageService.saveCourseWithSyllabus 會自動跑 AI
 *  - 上傳檔案 → selectPDFFile + readPDFFile → onSubmit(..., pdfData, ...)
 *  - 從網址 → 留白 (UI 顯示 disabled，標明 v0.7.x 後接)
 *
 * onSubmit signature 跟 legacy 完全一樣，方便 H18DeepApp 直接接。
 */

import { useState } from 'react';
import { selectPDFFile } from '../../services/fileService';
import s from './AddCourseDialog.module.css';

export type AddCourseSubmit = (
    title: string,
    keywords: string,
    pdfData?: ArrayBuffer,
    description?: string,
) => Promise<string | void | undefined>;

export interface AddCourseDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: AddCourseSubmit;
}

type SrcMode = 'text' | 'file' | 'url';

const SRC_OPTS: { k: SrcMode; label: string; hint: string }[] = [
    { k: 'text', label: '貼文字', hint: '貼大綱 / 老師的說明' },
    { k: 'file', label: '上傳檔案', hint: 'PDF · 透過 AI 萃取' },
    { k: 'url', label: '從網址', hint: 'v0.7.x 後接' },
];

function shortFileName(path: string): string {
    const seg = path.split(/[\\/]/);
    return seg[seg.length - 1] || path;
}

export default function AddCourseDialog({ isOpen, onClose, onSubmit }: AddCourseDialogProps) {
    const [src, setSrc] = useState<SrcMode>('text');
    const [title, setTitle] = useState('');
    const [keywords, setKeywords] = useState<string[]>([]);
    const [kwDraft, setKwDraft] = useState('');
    const [description, setDescription] = useState('');
    const [pdfFile, setPdfFile] = useState<{ path: string; data: ArrayBuffer } | null>(null);
    const [busy, setBusy] = useState(false);

    if (!isOpen) return null;

    const addKeyword = () => {
        const k = kwDraft.trim();
        if (!k) return;
        if (keywords.includes(k)) {
            setKwDraft('');
            return;
        }
        setKeywords([...keywords, k]);
        setKwDraft('');
    };

    const removeKeyword = (k: string) => setKeywords(keywords.filter((x) => x !== k));

    const handlePickFile = async () => {
        try {
            const picked = await selectPDFFile();
            if (picked) setPdfFile(picked);
        } catch (err) {
            console.warn('[AddCourseDialog] selectPDFFile failed:', err);
        }
    };

    const canSubmit = title.trim().length > 0 && !busy;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        try {
            const kwStr = keywords.join(', ');
            const pdfData = src === 'file' ? pdfFile?.data : undefined;
            const desc = src === 'text' ? description : undefined;
            await onSubmit(title.trim(), kwStr, pdfData, desc);
        } catch (err) {
            console.error('[AddCourseDialog] submit failed:', err);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={s.scrim} onClick={onClose}>
            <div
                className={s.modal}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="新增課程"
            >
                <div className={s.body}>
                    <h2 className={s.title}>新增課程</h2>
                    <div className={s.hint}>
                        先選個起點 — AI 會從這裡推論課程名稱、大綱與關鍵字
                    </div>

                    <div className={s.srcRow}>
                        {SRC_OPTS.map((o) => (
                            <button
                                key={o.k}
                                type="button"
                                onClick={() => setSrc(o.k)}
                                className={`${s.srcBtn} ${src === o.k ? s.srcBtnActive : ''}`}
                            >
                                <div className={s.srcBtnLabel}>{o.label}</div>
                                <div className={s.srcBtnHint}>{o.hint}</div>
                            </button>
                        ))}
                    </div>

                    <div className={s.srcBody}>
                        {src === 'text' && (
                            <textarea
                                className={s.textarea}
                                rows={7}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={`把課綱貼在這裡。例：\n\n計算機網路 · 陳老師 · 週三 10:00 · 資訊館 204\n單元：TCP / UDP / routing / socket / security ...`}
                            />
                        )}
                        {src === 'file' && (
                            <>
                                <button
                                    type="button"
                                    className={s.fileDrop}
                                    onClick={handlePickFile}
                                >
                                    <div className={s.fileDropIcon}>⎘</div>
                                    <div className={s.fileDropTitle}>
                                        {pdfFile ? '已選檔案 — 點擊更換' : '點擊選擇檔案'}
                                    </div>
                                    <div className={s.fileDropHint}>PDF · 最多 20 MB</div>
                                </button>
                                {pdfFile && (
                                    <div className={s.fileSelectedRow}>
                                        ✓ {shortFileName(pdfFile.path)} ·{' '}
                                        {(pdfFile.data.byteLength / 1024).toFixed(0)} KB
                                    </div>
                                )}
                            </>
                        )}
                        {src === 'url' && (
                            <>
                                <input
                                    className={s.urlInput}
                                    placeholder="https://www.csie.ntu.edu.tw/~.../syllabus.html"
                                    disabled
                                />
                                <div className={s.urlNote}>
                                    AI 會抓頁面 → 解析大綱 → 抽關鍵字。
                                    <em> P6.x · 留白</em> — 後端 web crawler 還沒接。
                                </div>
                            </>
                        )}
                    </div>

                    <div className={s.divider}>
                        <div className={s.dividerLabel}>填入課程資訊</div>
                        <div className={s.field}>
                            <div className={s.fieldLabel}>課程名稱 *</div>
                            <input
                                className={s.input}
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="例：計算機網路"
                                autoFocus
                            />
                        </div>
                        <div className={s.field}>
                            <div className={s.fieldLabel}>關鍵字 · 幫 AI 聚焦</div>
                            <div className={s.kwField}>
                                {keywords.map((k) => (
                                    <span key={k} className={s.kwChip}>
                                        {k}
                                        <span
                                            className={s.kwClose}
                                            onClick={() => removeKeyword(k)}
                                        >
                                            ✕
                                        </span>
                                    </span>
                                ))}
                                <input
                                    className={s.kwInput}
                                    value={kwDraft}
                                    onChange={(e) => setKwDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ',') {
                                            e.preventDefault();
                                            addKeyword();
                                        } else if (
                                            e.key === 'Backspace' &&
                                            !kwDraft &&
                                            keywords.length > 0
                                        ) {
                                            setKeywords(keywords.slice(0, -1));
                                        }
                                    }}
                                    onBlur={addKeyword}
                                    placeholder={
                                        keywords.length === 0
                                            ? '+ 加關鍵字 (Enter 確認)'
                                            : '+'
                                    }
                                />
                            </div>
                        </div>
                    </div>

                    <div className={s.actions}>
                        <span className={s.actionsHint}>
                            {src === 'text' && description.trim() && '提交後 AI 從說明文字生成課綱'}
                            {src === 'file' && pdfFile && '提交後 AI 從 PDF 生成課綱'}
                            {src === 'url' && '此來源 P6.x 後接'}
                        </span>
                        <button type="button" onClick={onClose} className={s.btnGhost}>
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={!canSubmit}
                            className={s.btnPrimary}
                        >
                            {busy ? '建立中…' : '✦ 建立'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
