/**
 * H18 NotesEditorPage · v0.7.0 Phase 6.9 (UI only)
 *
 * 對應 docs/design/h18-deep/h18-notes-editor.jsx (NotesEditorPage)。
 *
 * Per user Q5 lock：頁面要做、功能不接 backend → 純展示 H18 視覺。
 *
 * 範圍：
 *  - Top bar (breadcrumb + sync pill + mode toggle doc/canvas/split)
 *  - Sidebar (page list mock — 沒 schema)
 *  - Doc pane (markdown 樣式範例 article)
 *  - Canvas pane (toolbar + dot grid + empty state)
 *  - Split (doc 1fr + canvas 1fr)
 *
 * 全部留白（per Q5）：
 *  - 沒寫入 storageService
 *  - 沒 LaTeX render (KaTeX deferred — 先用 serif italic 假裝)
 *  - 沒 iPad mirror floating window
 *  - Canvas 沒實際筆畫，只有 grid + empty hint
 *  - sync pill 純 cosmetic 動畫
 */

import { useEffect, useState } from 'react';
import s from './NotesEditorPage.module.css';

export interface NotesEditorPageProps {
    onBack: () => void;
}

type Mode = 'doc' | 'canvas' | 'split';

const MOCK_PAGES = [
    { id: 'p1', title: 'Self-Attention 推導', meta: 'ML · L13 · 03' },
    { id: 'p2', title: 'Multi-head 的動機', meta: 'ML · L14 · 04' },
    { id: 'p3', title: 'Transformer 變體比較', meta: 'ML · L15 · 03', active: true },
    { id: 'p4', title: 'BERT vs GPT', meta: 'ML · L16' },
    { id: 'p5', title: '考前重點整理', meta: '草稿' },
];

const SYNC_CYCLE = ['drawing', 'syncing', 'synced', 'synced'] as const;

export default function NotesEditorPage({ onBack }: NotesEditorPageProps) {
    const [mode, setMode] = useState<Mode>('doc');
    const [activePage, setActivePage] = useState('p3');
    const [sync, setSync] = useState<(typeof SYNC_CYCLE)[number]>('drawing');

    useEffect(() => {
        let i = 0;
        const id = setInterval(() => {
            setSync(SYNC_CYCLE[i % SYNC_CYCLE.length]);
            i++;
        }, 3200);
        return () => clearInterval(id);
    }, []);

    const activeMeta = MOCK_PAGES.find((p) => p.id === activePage);

    return (
        <div className={s.page}>
            <div className={s.topbar}>
                <div className={s.crumb}>
                    <button type="button" onClick={onBack} className={s.backBtn}>
                        ← 返回
                    </button>
                    <span className={s.crumbDocTitle}>
                        {activeMeta?.title || '知識庫'}
                    </span>
                    <span className={s.crumbContext}>
                        {activeMeta?.meta || '草稿'}
                    </span>
                </div>
                <span className={s.syncPill}>
                    <span className={s.syncDot} />
                    {sync === 'drawing' ? '同步中…' : sync === 'syncing' ? '同步中…' : '已同步'}
                </span>
                <div className={s.modeRow}>
                    {(
                        [
                            { k: 'doc' as Mode, label: 'Doc' },
                            { k: 'canvas' as Mode, label: 'Canvas' },
                            { k: 'split' as Mode, label: 'Split' },
                        ] as const
                    ).map((o) => (
                        <button
                            key={o.k}
                            type="button"
                            onClick={() => setMode(o.k)}
                            className={`${s.modeBtn} ${mode === o.k ? s.modeBtnActive : ''}`}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className={s.body}>
                <aside className={s.sidebar}>
                    <div className={s.sectionHead}>頁面 · {MOCK_PAGES.length}</div>
                    {MOCK_PAGES.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => setActivePage(p.id)}
                            className={`${s.pageItem} ${p.id === activePage ? s.pageItemActive : ''}`}
                        >
                            <div>{p.title}</div>
                            <div className={s.pageItemMeta}>{p.meta}</div>
                        </button>
                    ))}
                    <button type="button" className={s.newPageBtn}>
                        + 新頁面
                    </button>
                </aside>

                {mode === 'doc' && <DocPane fullWidth />}
                {mode === 'canvas' && <CanvasPane fullWidth />}
                {mode === 'split' && (
                    <>
                        <DocPane fullWidth={false} />
                        <div className={s.splitDivider} />
                        <CanvasPane fullWidth={false} />
                    </>
                )}
            </div>
        </div>
    );
}

/* ────────── Doc pane ────────── */

function DocPane({ fullWidth }: { fullWidth: boolean }) {
    return (
        <div className={`${s.docPane} ${!fullWidth ? s.docPaneSplit : ''}`}>
            <div className={s.docInner}>
                <div className={s.docContext}>ML · L13 · 03 / 05</div>
                <h1 className={s.docTitle}>Multi-head 的動機</h1>
                <div className={s.docSub}>
                    老師現場推導 · 同步自麥克風轉錄 · 已匯入 iPad 手寫（2 張）
                </div>

                <div className={s.summaryCard}>
                    <div className={s.summaryHead}>✦ AI 摘要 · 本頁重點</div>
                    <div className={s.summaryBody}>
                        單頭 attention 只能捕捉一種 pattern。Multi-head 讓模型在
                        <span className={s.docHL}>不同 subspace 並行 attend</span>
                        ，提高表達力卻不增加總參數量（每頭維度降為 d/h）。
                    </div>
                </div>

                <p className={s.docPara}>
                    在單頭 attention 裡，query 向 key 算相似度後對 value 做加權。這樣的問題是：一個 token 只能同時關注<em>一種</em>語意關係。譬如英文句子 "The animal didn't cross the street because it was too tired"，
                    <code className={s.docCode}>it</code>需要同時 attend 到
                    <code className={s.docCode}>animal</code>（指涉）和
                    <code className={s.docCode}>tired</code>（敘述）。
                </p>

                <div className={s.equationBox}>
                    <div className={s.equationLabel}>EQUATION · multi-head</div>
                    MultiHead(Q, K, V) = Concat(head₁, …, head_h) · Wᴼ
                    <br />
                    head_i = Attention(QWᵢ_Q, KWᵢ_K, VWᵢ_V)
                </div>

                <p className={s.docPara}>
                    每個 head 的維度為 <code className={s.docCode}>d / h</code>，所以總計算量跟單頭差不多。h = 8 是 Transformer 原始論文的選擇，h = 16 在更大模型才出現。重點是<em>「並行 attend 多種 pattern」</em>這個直覺。
                </p>

                <h2 className={s.docSubHead}>要點整理</h2>
                <ul className={s.docList}>
                    <li>
                        參數量：<code className={s.docCode}>h · 3 · (d/h) · d = 3d²</code>，與單頭一致
                    </li>
                    <li>每頭獨立學會關注某一種 pattern（語法 / 指涉 / 位置 …）</li>
                    <li>
                        輸出再透過 <code className={s.docCode}>Wᴼ</code> concat 後回到原始維度 <code className={s.docCode}>d</code>
                    </li>
                </ul>

                <div className={s.recCallout}>
                    <span className={s.recCalloutIcon}>▸</span>
                    <span className={s.recCalloutTime}>錄音 · 26:14</span>
                    <span className={s.recCalloutQuote}>
                        「你可以想成<em>每個頭</em>都是一個獨立的小 attention…」
                    </span>
                    <button type="button" className={s.recCalloutBtn}>
                        ▸ 聽
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ────────── Canvas pane ────────── */

const TOOLS = [
    { id: 'select', g: '↖', t: '選取' },
    { id: 'pen', g: '✎', t: '筆' },
    { id: 'marker', g: '▐', t: '螢光筆' },
    { id: 'erase', g: '⌫', t: '橡皮擦' },
    { id: 'shape', g: '◯', t: '圖形' },
    { id: 'text', g: 'T', t: '文字' },
    { id: 'math', g: '∑', t: '公式' },
    { id: 'image', g: '⚘', t: '圖片' },
] as const;

const COLORS = ['#15140f', '#d24a1a', '#ffcd77', '#5a7a3e', '#3a6f8c', '#7a3f6e'];
const WEIGHTS = [1.5, 2.5, 4, 6];

function CanvasPane({ fullWidth: _fullWidth }: { fullWidth: boolean }) {
    const [tool, setTool] = useState<string>('pen');
    const [color, setColor] = useState(COLORS[0]);
    const [weight, setWeight] = useState(2.5);

    return (
        <div className={s.canvasPane}>
            <div className={s.canvasToolbar}>
                {TOOLS.map((it) => (
                    <button
                        key={it.id}
                        type="button"
                        onClick={() => setTool(it.id)}
                        title={it.t}
                        className={`${s.toolBtn} ${tool === it.id ? s.toolBtnActive : ''}`}
                    >
                        {it.g}
                    </button>
                ))}
                <div className={s.toolDivider} />
                {COLORS.map((c) => (
                    <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`${s.colorDot} ${c === color ? s.colorDotActive : ''}`}
                        style={{ background: c }}
                        aria-label={`color ${c}`}
                    />
                ))}
                <div className={s.toolDivider} />
                {WEIGHTS.map((w) => (
                    <button
                        key={w}
                        type="button"
                        onClick={() => setWeight(w)}
                        className={`${s.weightBtn} ${w === weight ? s.weightBtnActive : ''}`}
                        aria-label={`stroke ${w}`}
                    >
                        <span className={s.weightBar} style={{ height: w }} />
                    </button>
                ))}
            </div>

            <div className={s.canvasFabs}>
                <button type="button" className={s.canvasFab} title="AI 助教">
                    ✦
                </button>
                <button type="button" className={s.canvasFab} title="iPad 鏡像">
                    ⊞
                </button>
                <button type="button" className={s.canvasFab} title="OCR → LaTeX">
                    ∑
                </button>
            </div>

            <div className={s.canvasArea}>
                <div className={s.canvasGrid}>
                    <div className={s.canvasEmptyHint}>
                        Canvas 空白
                        <br />
                        Apple Pencil / 滑鼠開始畫，或 ⌘V 貼圖。
                        <br />
                        <span style={{ color: 'var(--h18-text-faint)' }}>
                            CP-6.9 · 純 UI · 沒接 backend
                        </span>
                    </div>
                </div>
            </div>

            <div className={s.canvasFooter}>
                <div>1600 × 1200 · 圖層 0 · 筆劃 0</div>
                <div>留白：實際 stroke / pressure / undo 沒接</div>
            </div>
        </div>
    );
}
