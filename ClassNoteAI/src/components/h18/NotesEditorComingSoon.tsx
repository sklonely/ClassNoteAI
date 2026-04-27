/**
 * NotesEditorComingSoon · v0.7.0
 *
 * 取代 NotesEditorPage。本版只放 Coming Soon overlay，背景是
 * 模糊化的 doc-style 預覽，讓使用者看到「之後會有什麼」但目前不能用。
 *
 * 真實的 NotesEditorPage 元件還在 src/components/h18/NotesEditorPage.tsx
 * (per Q5 lock UI only)，下個 milestone 重新啟用。
 */

import s from './NotesEditorComingSoon.module.css';

export interface NotesEditorComingSoonProps {
    onBack: () => void;
}

export default function NotesEditorComingSoon({ onBack }: NotesEditorComingSoonProps) {
    return (
        <div className={s.page}>
            <div className={s.topbar}>
                <button type="button" onClick={onBack} className={s.backBtn}>
                    ← 返回
                </button>
                <span className={s.crumbCourse}>知識庫</span>
                <span className={s.crumbContext}>BETA · COMING SOON</span>
            </div>

            <div className={s.body}>
                {/* Blurred preview backdrop — fake doc layout pieces */}
                <div className={s.blurredPreview} aria-hidden>
                    <FakeDocPreview />
                </div>
                <div className={s.scrim} aria-hidden />

                {/* Coming Soon overlay */}
                <div className={s.overlay}>
                    <div className={s.eyebrow}>COMING SOON</div>
                    <h1 className={s.title}>知識庫</h1>
                    <div className={s.titleSub}>跨課筆記 · 白板 · LaTeX</div>
                    <p className={s.descLine}>
                        把錄音轉錄、AI 摘要跟 iPad 手寫整合進一個 markdown / canvas 雙模式的編輯器。
                        v0.7.x 會把現在的 review 筆記頁升級到這個樣子。
                    </p>
                    <div className={s.featurePills}>
                        <span className={s.featurePill}>doc · canvas · split</span>
                        <span className={s.featurePill}>LaTeX block</span>
                        <span className={s.featurePill}>iPad 即時鏡像</span>
                        <span className={s.featurePill}>跨課拼接</span>
                    </div>
                    <div className={s.versionTag}>預計 v0.7.x</div>
                </div>
            </div>
        </div>
    );
}

/**
 * Pure-CSS / inline mock representing a doc page (used as blurred backdrop).
 * Doesn't need to be readable — just shapes / colors that BLUR into a
 * pleasing texture.
 */
function FakeDocPreview() {
    const blockBg = 'var(--h18-surface)';
    const blockBg2 = 'var(--h18-surface2)';
    const accentBg = 'color-mix(in srgb, var(--h18-accent) 30%, transparent)';
    const text = 'color-mix(in srgb, var(--h18-text) 80%, transparent)';
    const textDim = 'color-mix(in srgb, var(--h18-text) 40%, transparent)';

    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'grid',
                gridTemplateColumns: '200px 1fr',
                gap: 1,
                background: 'var(--h18-border)',
            }}
        >
            {/* Sidebar */}
            <aside
                style={{
                    background: blockBg2,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                }}
            >
                {Array.from({ length: 6 }, (_, i) => (
                    <div
                        key={i}
                        style={{
                            padding: '10px 12px',
                            borderRadius: 6,
                            background: i === 2 ? 'var(--h18-sel-bg)' : 'transparent',
                        }}
                    >
                        <div
                            style={{
                                height: 8,
                                background: text,
                                borderRadius: 2,
                                width: ['65%', '85%', '70%', '55%', '75%', '40%'][i],
                            }}
                        />
                        <div
                            style={{
                                height: 5,
                                background: textDim,
                                borderRadius: 2,
                                width: '50%',
                                marginTop: 4,
                            }}
                        />
                    </div>
                ))}
            </aside>

            {/* Doc body */}
            <main
                style={{
                    background: blockBg,
                    padding: '60px 80px',
                    overflow: 'hidden',
                }}
            >
                <div
                    style={{
                        maxWidth: 720,
                        margin: '0 auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14,
                    }}
                >
                    {/* H1 */}
                    <div style={{ height: 30, width: '60%', background: text, borderRadius: 4 }} />
                    <div style={{ height: 12, width: '40%', background: textDim, borderRadius: 3 }} />
                    {/* AI summary card */}
                    <div
                        style={{
                            marginTop: 16,
                            padding: 16,
                            borderRadius: 8,
                            background: accentBg,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                        }}
                    >
                        <div style={{ height: 8, width: '30%', background: text, borderRadius: 2 }} />
                        <div style={{ height: 8, width: '95%', background: text, borderRadius: 2 }} />
                        <div style={{ height: 8, width: '88%', background: text, borderRadius: 2 }} />
                    </div>
                    {/* Paragraphs */}
                    {Array.from({ length: 5 }, (_, i) => (
                        <div
                            key={i}
                            style={{
                                height: 10,
                                width: ['100%', '94%', '98%', '90%', '85%'][i],
                                background: text,
                                borderRadius: 2,
                            }}
                        />
                    ))}
                    {/* Equation block */}
                    <div
                        style={{
                            margin: '14px 0',
                            padding: 22,
                            borderRadius: 10,
                            background: blockBg2,
                            border: `1px solid var(--h18-border-soft)`,
                            textAlign: 'center',
                        }}
                    >
                        <div style={{ height: 16, width: '60%', margin: '0 auto', background: text, borderRadius: 3 }} />
                    </div>
                    {/* List */}
                    {Array.from({ length: 4 }, (_, i) => (
                        <div
                            key={i}
                            style={{
                                display: 'flex',
                                gap: 10,
                                paddingLeft: 18,
                            }}
                        >
                            <div style={{ height: 9, width: 9, borderRadius: 4, background: textDim, flexShrink: 0, marginTop: 2 }} />
                            <div
                                style={{
                                    flex: 1,
                                    height: 9,
                                    width: ['85%', '75%', '92%', '68%'][i],
                                    background: text,
                                    borderRadius: 2,
                                }}
                            />
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );
}
